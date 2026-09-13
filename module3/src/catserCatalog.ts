/**
 * Catálogo fixo de códigos CATSER (Compras.gov.br) para serviços de TI -- a API real do módulo
 * "Pesquisa de Preço" (`modulo-pesquisa-preco/3_consultarServico`) exige um `codigoItemCatalogo`
 * numérico, e não existe endpoint de busca textual para serviços (só para materiais). Cada
 * código abaixo foi navegado e confirmado ao vivo em 12-13/09/2026 pela hierarquia real da API
 * (`1_consultarSecaoServico` -> ... -> `6_consultarItemServico`, Seção 1 = "SERVIÇOS DE
 * TECNOLOGIA DA INFORMAÇÃO E COMUNICAÇÃO - TIC"), nunca inventado.
 *
 * Ampliar este catálogo é só navegar a mesma hierarquia para uma divisão/grupo/classe nova e
 * confirmar o `codigoServico` real antes de adicionar aqui -- nunca um código "parecido" ou
 * estimado.
 */
export interface CatserCategory {
  /** Chave estável usada na rota /v1/mod3/service-prices e no worker. */
  key: string;
  /** Rótulo amigável pra UI. */
  label: string;
  /** codigoItemCatalogo real, confirmado contra a API. */
  codigoItemCatalogo: number;
}

export const CATSER_CATALOG: CatserCategory[] = [
  // Divisão 11, Grupo 111, Classe 1111 -- desenvolvimento/manutenção evolutiva de software, por linguagem.
  { key: "dev-java", label: "Desenvolvimento de software — Java", codigoItemCatalogo: 25852 },
  { key: "dev-php", label: "Desenvolvimento de software — PHP", codigoItemCatalogo: 25860 },
  { key: "dev-dotnet", label: "Desenvolvimento de software — .NET/C#", codigoItemCatalogo: 25879 },
  { key: "dev-python", label: "Desenvolvimento de software — Python", codigoItemCatalogo: 25887 },
  { key: "dev-mobile", label: "Desenvolvimento de software — dispositivos móveis", codigoItemCatalogo: 25895 },
  { key: "dev-mainframe", label: "Desenvolvimento de software — mainframe", codigoItemCatalogo: 25909 },
  { key: "dev-outras", label: "Desenvolvimento de software — outras linguagens", codigoItemCatalogo: 25917 },
  // Divisão 11, Grupo 112, Classe 1121 -- manutenção e sustentação de software.
  { key: "manutencao-software", label: "Manutenção de software (corretiva/preventiva/adaptativa)", codigoItemCatalogo: 25992 },
  { key: "sustentacao-software", label: "Sustentação de software", codigoItemCatalogo: 26000 },
  // Divisão 13, Grupo 131, Classe 1311 -- computação em nuvem (IaaS).
  { key: "nuvem-iaas", label: "Infraestrutura como serviço (IaaS)", codigoItemCatalogo: 26050 },
  // Divisão 17, Grupo 173, Classe 1731 -- consultoria em TIC (código ativo mais recente).
  { key: "consultoria-tic", label: "Consultoria em Tecnologia da Informação e Comunicação (TIC)", codigoItemCatalogo: 27332 },
];

export function findCatserCategory(key: string): CatserCategory | undefined {
  return CATSER_CATALOG.find((c) => c.key === key);
}
