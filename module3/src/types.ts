export interface PublicTender {
  externalId: string;
  source: string;
  object: string;
  state?: string;
  tenderDate?: string;
  url?: string;
  raw: unknown;
}

/** Um preço praticado real, do modulo "Pesquisa de Preço" do Compras.gov.br
 * (dadosabertos.compras.gov.br/modulo-pesquisa-preco) para um item de serviço (CATSER)
 * especifico -- sucessor do extinto Painel de Preços. Nao e um "tender": e um ponto de preço
 * unitario ja consolidado a partir de uma contratação concluida. */
export interface ServicePriceObservation {
  idItemCompra: number;
  codigoItemCatalogo: number;
  descricaoItem: string;
  precoUnitario: number;
  unidadeMedida: string;
  municipio?: string;
  estado?: string;
  orgao?: string;
  dataCompra?: string;
  raw: unknown;
}

export interface Module3Config {
  databaseUrl?: string;
  port: number;
  apiKey?: string;
  requestTimeoutMs: number;
  maxRetries: number;
}