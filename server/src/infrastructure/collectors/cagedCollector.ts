/**
 * Ingestao do Novo CAGED (PDET/MTE) -- a primeira fonte salarial REAL do Pivo.
 *
 * Contexto: `laborProfiles` (catalogs.ts) sempre declarou `benchmarkSource: "CAGED/MTE"` com
 * `sourceStatus: "FALLBACK_STALE"`, mas o CAGED nunca havia sido ingerido -- os numeros eram
 * estimativa parametrizada. Este modulo fecha essa lacuna.
 *
 * ## Por que nao e um coletor HTTP como os outros
 *
 * O MTE nao publica API. Os microdados sao um arquivo `.7z` por mes num servidor FTP anonimo
 * (`ftp://ftp.mtps.gov.br/pdet/microdados/NOVO CAGED/`), com ~55 MB comprimidos e centenas de
 * MB de texto `;`-delimitado dentro -- uma linha por movimentacao de emprego no Brasil no mes.
 *
 * Consequencias de desenho, todas deliberadas:
 *
 * - **Nao roda em request nem na Lambda de precos.** E um lote mensal, agendado a parte
 *   (.github/workflows/ingest-caged.yml). O runner do GitHub ja tem `7z` e `curl`, 14 GB de RAM
 *   e 6h de limite; empacotar um descompressor numa imagem de Lambda seria complexidade sem
 *   ganho para um job que roda uma vez por mes.
 * - **Streaming, nunca `readFile`.** O arquivo descomprimido nao cabe confortavelmente em
 *   memoria: lemos a saida do `7z` linha a linha.
 * - **Le o cabecalho em vez de fixar posicao de coluna.** O layout ja mudou entre versoes do
 *   CAGED; indice fixo quebraria em silencio, lendo idade no lugar de salario.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { logger } from "../observability/logger";

const FTP_BASE = "ftp://ftp.mtps.gov.br/pdet/microdados/NOVO%20CAGED";

/**
 * CBOs 2002 de TI, sem hifen -- que e o formato do proprio CAGED. Filtrar por eles derruba o
 * volume de milhoes de linhas para dezenas de milhares e e o que torna o calculo de percentil
 * viavel em memoria.
 *
 * Os titulos sao os OFICIAIS da CBO 2002, conferidos um a um. A primeira versao deste mapa foi
 * escrita de cabeca e estava errada em 6 dos 9 codigos -- o erro so apareceu porque a ingestao
 * real mostrou "Analista de suporte computacional" com mediana de R$ 15.000, acima de
 * desenvolvimento. O numero estava certo: 2124-25 e "Arquiteto de solucoes de TI", nao suporte.
 * Rotulo errado aqui nao quebra nada visivelmente -- so atribui salario ao cargo errado, em
 * silencio, numa ferramenta cujo proposito e sustentar estimativa auditavel.
 */
export const CBOS_TI: Record<string, string> = {
  // Familia 1425 -- Gerentes de tecnologia da informacao
  "142505": "Gerente de rede",
  "142510": "Gerente de desenvolvimento de sistemas",
  "142515": "Gerente de produção de tecnologia da informação",
  "142520": "Gerente de projetos de tecnologia da informação",
  "142525": "Gerente de segurança de tecnologia da informação",
  "142530": "Gerente de suporte técnico de tecnologia da informação",

  // Familia 2123 -- Administradores de TI. Fica FORA da familia 2124, detalhe que ja gerou erro
  // no catalogo interno: "Administrador de banco de dados" estava com o CBO 2124-15, que na
  // verdade e "Analista de sistemas de automacao".
  "212305": "Administrador de banco de dados",
  "212310": "Administrador de redes",
  "212315": "Administrador de sistemas operacionais",

  // Familia 2124 -- Analistas de tecnologia da informacao
  "212405": "Analista de desenvolvimento de sistemas",
  "212410": "Analista de redes e de comunicação de dados",
  "212415": "Analista de sistemas de automação",
  "212420": "Analista de suporte computacional",
  "212425": "Arquiteto de soluções de tecnologia da informação",
  "212430": "Analista de testes de tecnologia da informação",

  // Familia 3171 -- Tecnicos de desenvolvimento de sistemas e aplicacoes
  "317105": "Programador de internet",
  "317110": "Programador de sistemas de informação",
  "317120": "Programador de multimídia",
};

/** Codigo IBGE de UF -> sigla. O CAGED grava a UF como codigo numerico. */
const UF_POR_CODIGO: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
  "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR",
  "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

/** Jornada minima para a observacao entrar na amostra: meio periodo distorce a mediana mensal. */
const MIN_HORAS_CONTRATUAIS = 30;
/** Piso de sanidade: salario declarado abaixo disso e erro de digitacao ou jornada atipica. */
const MIN_SALARIO = 500;
/** Teto de sanidade: acima disso quase sempre e erro de preenchimento (centavos como reais). */
const MAX_SALARIO = 200_000;
/** Amostra minima para publicar um recorte. Mediana de 4 admissoes nao e benchmark, e ainda
 * levanta risco de reidentificacao num recorte geografico pequeno. */
export const MIN_AMOSTRA = 30;

export interface CagedAggregate {
  cbo: string;
  uf: string | null;
  nAmostra: number;
  p25: number;
  mediana: number;
  p75: number;
  media: number;
}

export interface CagedIngestionResult {
  competencia: string;
  sourceUrl: string;
  linhasLidas: number;
  linhasConsideradas: number;
  agregados: CagedAggregate[];
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} saiu com ${code}: ${err.slice(0, 300)}`))));
  });
}

/** Remove acentos e normaliza o cabecalho para casar nome de coluna sem depender de acentuacao. */
function normalizeHeader(name: string): string {
  return name
    .replace(/^﻿/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

/** CAGED usa virgula decimal ("2500,50"). */
function parseSalario(raw: string): number {
  const n = Number(raw.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function percentil(ordenado: number[], p: number): number {
  if (!ordenado.length) return 0;
  const idx = (ordenado.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return ordenado[lo];
  return ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (idx - lo);
}

/**
 * Descobre a competencia mais recente publicada no FTP. O MTE publica com ~1 mes de defasagem e
 * nem sempre no mesmo dia, entao perguntar ao servidor e mais confiavel que calcular a partir da
 * data de hoje.
 */
export async function descobrirUltimaCompetencia(): Promise<string> {
  const anos = (await run("curl", ["-s", "--max-time", "60", "--list-only", `${FTP_BASE}/`]))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d{4}$/.test(l))
    .sort();

  const ultimoAno = anos.at(-1);
  if (!ultimoAno) throw new Error("Nenhum diretorio de ano encontrado no FTP do PDET.");

  const meses = (await run("curl", ["-s", "--max-time", "60", "--list-only", `${FTP_BASE}/${ultimoAno}/`]))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d{6}$/.test(l))
    .sort();

  const ultima = meses.at(-1);
  if (!ultima) throw new Error(`Nenhuma competencia encontrada em ${ultimoAno} no FTP do PDET.`);
  return ultima;
}

/**
 * Nucleo da ingestao: le as linhas do CAGED e devolve os percentis por (CBO, UF) e por CBO
 * nacional. Recebe um iteravel de linhas em vez de abrir o arquivo por conta propria justamente
 * para ser testavel sem rede, sem FTP e sem `7z` -- e aqui que moram as decisoes que podem
 * corromper o resultado em silencio (mapeamento de coluna, filtro de admissao, corte de
 * jornada, virgula decimal).
 */
export async function agregarLinhas(
  linhas: AsyncIterable<string> | Iterable<string>,
): Promise<{ linhasLidas: number; linhasConsideradas: number; agregados: CagedAggregate[] }> {
  let idx: Record<string, number> | null = null;
  let linhasLidas = 0;
  let linhasConsideradas = 0;
  // chave "cbo|uf" e "cbo|" (nacional) -> lista de salarios
  const grupos = new Map<string, number[]>();

  for await (const linha of linhas as AsyncIterable<string>) {
    if (!linha.trim()) continue;

    if (idx === null) {
      // Primeira linha e o cabecalho: mapeia nome -> posicao, para nao depender de ordem fixa.
      const cols = linha.split(";").map(normalizeHeader);
      idx = {
        uf: cols.indexOf("uf"),
        cbo: cols.findIndex((c) => c.startsWith("cbo2002")),
        saldo: cols.findIndex((c) => c.startsWith("saldomovimentacao")),
        salario: cols.indexOf("salario"),
        horas: cols.findIndex((c) => c.startsWith("horascontratuais")),
      };
      const faltando = Object.entries(idx).filter(([, v]) => v < 0).map(([k]) => k);
      if (faltando.length) {
        throw new Error(
          `Layout do CAGED mudou: colunas nao encontradas (${faltando.join(", ")}). Cabecalho: ${linha.slice(0, 300)}`,
        );
      }
      continue;
    }

    linhasLidas++;
    const campos = linha.split(";");

    // So admissoes: o salario de um DESLIGAMENTO e o de saida, sinal diferente do que queremos
    // (quanto o mercado esta pagando para contratar hoje).
    if (campos[idx.saldo]?.trim() !== "1") continue;

    const cbo = campos[idx.cbo]?.trim();
    if (!cbo || !CBOS_TI[cbo]) continue;

    const horas = Number(campos[idx.horas]?.trim().replace(",", "."));
    if (!Number.isFinite(horas) || horas < MIN_HORAS_CONTRATUAIS) continue;

    const salario = parseSalario(campos[idx.salario] ?? "");
    if (!Number.isFinite(salario) || salario < MIN_SALARIO || salario > MAX_SALARIO) continue;

    const uf = UF_POR_CODIGO[campos[idx.uf]?.trim()] ?? null;

    linhasConsideradas++;
    // Grava no recorte estadual e no nacional: a busca depois degrada de cidade -> UF -> Brasil.
    for (const chave of [`${cbo}|${uf ?? ""}`, `${cbo}|`]) {
      const lista = grupos.get(chave);
      if (lista) lista.push(salario);
      else grupos.set(chave, [salario]);
    }
  }

  const agregados: CagedAggregate[] = [];
  for (const [chave, salarios] of grupos) {
    if (salarios.length < MIN_AMOSTRA) continue;
    const [cbo, ufRaw] = chave.split("|");
    salarios.sort((a, b) => a - b);
    agregados.push({
      cbo,
      uf: ufRaw || null,
      nAmostra: salarios.length,
      p25: Math.round(percentil(salarios, 0.25)),
      mediana: Math.round(percentil(salarios, 0.5)),
      p75: Math.round(percentil(salarios, 0.75)),
      media: Math.round(salarios.reduce((t, s) => t + s, 0) / salarios.length),
    });
  }

  agregados.sort((a, b) => b.nAmostra - a.nAmostra);
  return { linhasLidas, linhasConsideradas, agregados };
}

/**
 * Baixa, descomprime e agrega uma competencia. Devolve mediana/percentis por (CBO, UF) e por
 * CBO nacional (uf: null).
 */
export async function ingestCagedCompetencia(competencia: string): Promise<CagedIngestionResult> {
  const ano = competencia.slice(0, 4);
  const arquivo = `CAGEDMOV${competencia}.7z`;
  const sourceUrl = `${FTP_BASE}/${ano}/${competencia}/${arquivo}`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caged-"));
  const destino = path.join(dir, arquivo);

  try {
    logger.info("Baixando microdados do CAGED", { competencia, sourceUrl });
    await run("curl", ["-s", "--fail", "--max-time", "900", "-o", destino, sourceUrl]);

    const tamanhoMb = (fs.statSync(destino).size / 1024 / 1024).toFixed(1);
    logger.info("Download concluido; descomprimindo em streaming", { competencia, tamanhoMb });

    // `x -so` joga o conteudo descomprimido em stdout: nunca materializamos o arquivo inteiro
    // (centenas de MB) em disco nem em memoria.
    const sevenZip = spawn("7z", ["x", "-so", destino]);
    sevenZip.stderr.resume(); // 7z escreve o banner em stderr; ignorar.

    const rl = readline.createInterface({ input: sevenZip.stdout, crlfDelay: Infinity });
    const { linhasLidas, linhasConsideradas, agregados } = await agregarLinhas(rl);

    await new Promise<void>((resolve, reject) => {
      sevenZip.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`7z saiu com codigo ${code}`))));
      sevenZip.on("error", reject);
    });

    agregados.sort((a, b) => b.nAmostra - a.nAmostra);
    return { competencia, sourceUrl, linhasLidas, linhasConsideradas, agregados };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** "202607" -> "2026-07-01", o formato de `salary_observations.competencia`. */
export function competenciaParaData(competencia: string): string {
  return `${competencia.slice(0, 4)}-${competencia.slice(4, 6)}-01`;
}
