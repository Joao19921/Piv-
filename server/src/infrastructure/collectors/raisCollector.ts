/**
 * Ingestao da RAIS (Relacao Anual de Informacoes Sociais, mesmo MTE/PDET do Novo CAGED) --
 * segunda fonte salarial real do Pivo.
 *
 * ## Por que RAIS, ao lado do CAGED, nunca no lugar
 *
 * O CAGED e fluxo (admissoes/desligamentos do mes); a RAIS e estoque (vinculos ativos em
 * 31/12 do ano-base). Amostra da RAIS por CBO/UF e ordens de magnitude maior que uma unica
 * competencia do CAGED, mas a defasagem e de ~12 meses (a RAIS de um ano-base sai completa
 * so em dezembro do ano seguinte). Por isso a RAIS fica como referencia adicional
 * (`referenciaRais` em EnrichedLaborProfile), nunca substituindo o valor de mercado do CAGED
 * -- decisao de produto, nao limitacao tecnica.
 *
 * ## Formato real (verificado em 12/09/2026, nao presumido)
 *
 * FTP anonimo `ftp://ftp.mtps.gov.br/pdet/microdados/RAIS/<ano>/`, um arquivo `.7z` por
 * REGIAO (nao um arquivo nacional unico como o CAGED): `RAIS_VINC_PUB_NORTE.7z`,
 * `_NORDESTE`, `_CENTRO_OESTE`, `_MG_ES_RJ`, `_SP`, `_SUL`, `_NI` (nao identificado). A
 * partir da RAIS ano-base 2024 o arquivo descompactado e `.COMT`: CSV separado por VIRGULA
 * (nao ponto-e-virgula como o CAGED), com cabecalho, campos entre aspas, decimais com PONTO
 * (nao virgula). Colunas relevantes confirmadas no cabecalho real: `CBO 2002 Ocupacao -
 * Codigo` (mesma CBO 2002 de 6 digitos do CAGED), `Municipio Trab - Codigo` (IBGE, 7 digitos
 * -- os 2 primeiros sao o codigo de UF, mesma tabela UF_POR_CODIGO do CAGED), `Ind Vinculo
 * Ativo 31/12 - Codigo` (filtra o estoque de fim de ano) e `Vl Rem Media Nom` (remuneracao
 * media nominal do ano, o equivalente RAIS do salario do CAGED).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { logger } from "../observability/logger";
import { CBOS_TI } from "./cagedCollector";

const FTP_BASE = "ftp://ftp.mtps.gov.br/pdet/microdados/RAIS";

/** Um arquivo por regiao -- a RAIS nao publica um unico arquivo nacional como o Novo CAGED. */
const REGIOES = ["NORTE", "NORDESTE", "CENTRO_OESTE", "MG_ES_RJ", "SP", "SUL", "NI"] as const;

/** Codigo IBGE de UF -> sigla. Mesma tabela do cagedCollector.ts (RAIS grava municipio, nao UF
 * direto -- os 2 primeiros digitos do codigo IBGE de 7 digitos sao o codigo de UF). */
const UF_POR_CODIGO: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
  "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR",
  "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

/** Mesmo piso/teto de sanidade do CAGED -- remuneracao media anual fora disso e erro de
 * preenchimento, nao dado real. */
const MIN_SALARIO = 500;
const MAX_SALARIO = 200_000;
/** Mesma amostra minima do CAGED: recorte menor que isso nao e benchmark e arrisca
 * reidentificacao geografica. */
export const MIN_AMOSTRA = 30;

export interface RaisAggregate {
  cbo: string;
  uf: string | null;
  nAmostra: number;
  p25: number;
  mediana: number;
  p75: number;
  media: number;
}

export interface RaisIngestionResult {
  ano: string;
  sourceUrl: string;
  linhasLidas: number;
  linhasConsideradas: number;
  agregados: RaisAggregate[];
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

function normalizeHeader(name: string): string {
  return name
    .replace(/^﻿/, "")
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

/** Parser minimo de uma linha CSV com aspas -- o arquivo da RAIS usa virgula como separador E
 * como poderia aparecer dentro de um campo entre aspas (nao ocorre nos campos que usamos, que
 * sao sempre codigo/numero, mas um split ingenuo por vírgula quebraria em silencio se um dia
 * um campo textual citado contiver virgula). */
function splitCsvLine(linha: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let entreAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') {
      entreAspas = !entreAspas;
    } else if (ch === "," && !entreAspas) {
      campos.push(atual);
      atual = "";
    } else {
      atual += ch;
    }
  }
  campos.push(atual);
  return campos;
}

/** RAIS usa ponto decimal ("1637.69"), diferente da virgula decimal do CAGED. */
function parseSalario(raw: string): number {
  const n = Number(raw.trim());
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
 * Descobre o ano mais recente com dados publicados no FTP. A RAIS publica em duas ondas
 * (parcial no meio do ano seguinte, completa no fim) -- perguntar ao servidor evita ter que
 * acertar o calendario de publicacao, que ja variou entre 2024 e 2025.
 */
export async function descobrirUltimoAno(): Promise<string> {
  const anos = (await run("curl", ["-s", "--max-time", "60", "--list-only", `${FTP_BASE}/`]))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d{4}$/.test(l))
    .sort();

  const ultimo = anos.at(-1);
  if (!ultimo) throw new Error("Nenhum diretorio de ano encontrado no FTP da RAIS.");
  return ultimo;
}

/**
 * Nucleo da ingestao: le as linhas de UM arquivo regional da RAIS e acumula nos grupos
 * (cbo|uf) passados por referencia -- os agregados finais só saem depois de somar as 7
 * regioes, senao cada regiao vira um recorte "nacional" incompleto.
 */
export async function agregarLinhasRais(
  linhas: AsyncIterable<string> | Iterable<string>,
  grupos: Map<string, number[]>,
): Promise<{ linhasLidas: number; linhasConsideradas: number }> {
  let idx: Record<string, number> | null = null;
  let linhasLidas = 0;
  let linhasConsideradas = 0;

  for await (const linha of linhas as AsyncIterable<string>) {
    if (!linha.trim()) continue;

    if (idx === null) {
      const cols = splitCsvLine(linha).map(normalizeHeader);
      idx = {
        cbo: cols.findIndex((c) => c.startsWith("cbo2002")),
        municipio: cols.findIndex((c) => c === "municipiocodigo"),
        ativo3112: cols.findIndex((c) => c.startsWith("indvinculoativo3112")),
        remMedia: cols.findIndex((c) => c.startsWith("vlremmedianom")),
      };
      const faltando = Object.entries(idx).filter(([, v]) => v < 0).map(([k]) => k);
      if (faltando.length) {
        throw new Error(
          `Layout da RAIS mudou: colunas nao encontradas (${faltando.join(", ")}). Cabecalho: ${linha.slice(0, 400)}`,
        );
      }
      continue;
    }

    linhasLidas++;
    const campos = splitCsvLine(linha);

    // So estoque ativo em 31/12: e o que a RAIS mede por definicao (o "1" e o codigo de
    // vinculo ativo no cabecalho da declaracao -- confirmado contra uma linha real).
    if (campos[idx.ativo3112]?.trim() !== "1") continue;

    const cbo = campos[idx.cbo]?.trim();
    if (!cbo || !CBOS_TI[cbo]) continue;

    const salario = parseSalario(campos[idx.remMedia] ?? "");
    if (!Number.isFinite(salario) || salario < MIN_SALARIO || salario > MAX_SALARIO) continue;

    const municipio = campos[idx.municipio]?.trim().replace(/^"|"$/g, "") ?? "";
    const uf = UF_POR_CODIGO[municipio.slice(0, 2)] ?? null;

    linhasConsideradas++;
    // Grava sempre no nacional (`${cbo}|`) e, so quando a UF e conhecida, tambem no recorte
    // estadual (`${cbo}|${uf}`) -- as duas chaves colidem quando uf e null (arquivo NI, por
    // exemplo), e empurrar pras duas nesse caso contaria o mesmo salario duas vezes no
    // recorte nacional.
    const chaveNacional = `${cbo}|`;
    const listaNacional = grupos.get(chaveNacional);
    if (listaNacional) listaNacional.push(salario);
    else grupos.set(chaveNacional, [salario]);

    if (uf) {
      const chaveRegional = `${cbo}|${uf}`;
      const listaRegional = grupos.get(chaveRegional);
      if (listaRegional) listaRegional.push(salario);
      else grupos.set(chaveRegional, [salario]);
    }
  }

  return { linhasLidas, linhasConsideradas };
}

function agregarGrupos(grupos: Map<string, number[]>): RaisAggregate[] {
  const agregados: RaisAggregate[] = [];
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
  return agregados;
}

/** Baixa, descomprime (streaming, nunca materializa o arquivo inteiro) e agrega as 7 regioes
 * de um ano-base. */
export async function ingestRaisAno(ano: string): Promise<RaisIngestionResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rais-"));
  const grupos = new Map<string, number[]>();
  let linhasLidas = 0;
  let linhasConsideradas = 0;

  try {
    for (const regiao of REGIOES) {
      const arquivo = `RAIS_VINC_PUB_${regiao}.7z`;
      const sourceUrl = `${FTP_BASE}/${ano}/${arquivo}`;
      const destino = path.join(dir, arquivo);

      logger.info("Baixando microdados da RAIS", { ano, regiao, sourceUrl });
      await run("curl", ["-s", "--fail", "--max-time", "900", "-o", destino, sourceUrl]);

      const sevenZip = spawn("7z", ["x", "-so", destino]);
      sevenZip.stderr.resume();
      // O .COMT da RAIS e ISO-8859-1 (confirmado via `file` num arquivo real baixado em
      // 12/09/2026) -- sem declarar o encoding aqui, o Node le como UTF-8 por padrao e corrompe
      // toda letra acentuada do cabecalho ("Código" vira lixo), o que faz o casamento de coluna
      // em normalizeHeader() falhar silenciosamente (ou, como aconteceu numa verificacao real
      // desta implementacao, falhar ruidosamente com "colunas nao encontradas").
      sevenZip.stdout.setEncoding("latin1");

      const rl = readline.createInterface({ input: sevenZip.stdout, crlfDelay: Infinity });
      const resultado = await agregarLinhasRais(rl, grupos);
      linhasLidas += resultado.linhasLidas;
      linhasConsideradas += resultado.linhasConsideradas;

      await new Promise<void>((resolve, reject) => {
        sevenZip.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`7z saiu com codigo ${code} (regiao ${regiao})`))));
        sevenZip.on("error", reject);
      });

      logger.info("Regiao da RAIS processada", { ano, regiao, linhasConsideradas: resultado.linhasConsideradas });
      // Apaga o .7z da regiao assim que ela termina, em vez de esperar o fim do loop: sao 7
      // arquivos, alguns >1GB, e nao ha motivo pra manter todos no disco ao mesmo tempo.
      fs.rmSync(destino, { force: true });
    }

    return {
      ano,
      sourceUrl: `${FTP_BASE}/${ano}/`,
      linhasLidas,
      linhasConsideradas,
      agregados: agregarGrupos(grupos),
    };
  } finally {
    // No Windows, o handle do processo `7z` as vezes so libera o arquivo um instante depois do
    // evento 'close' -- rmSync do diretorio pode falhar com EPERM por uma corrida de milissegundos.
    // Isso nunca acontece no runner do CI (Linux), mas falhar a ingestao inteira so por causa da
    // limpeza de um diretorio temporario (o dado ja foi lido e devolvido) seria pior que um aviso.
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      logger.warn("Nao foi possivel limpar o diretorio temporario da RAIS (nao afeta o resultado)", {
        dir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** "2025" -> "2025-12-31", competencia da RAIS (estoque de fim de ano-base, ver
 * `salary_observations.competencia`). */
export function anoParaData(ano: string): string {
  return `${ano}-12-31`;
}
