import "dotenv/config";
import { CATSER_CATALOG } from "./catserCatalog";
import { getModule3Config } from "./config";
import { closeDatabase, saveSearch, saveServicePrices } from "./db";
import { consultarPrecoServico, searchPncp } from "./sources";

const terms = (process.env.MOD3_TERMS ?? "Desenvolvedor React,Consultoria SAP,Notebook i7")
  .split(",").map((term) => term.trim()).filter(Boolean);
const config = getModule3Config();

try {
  for (const term of terms) {
    const pncp = await searchPncp(term, config);
    await saveSearch(term, pncp);
    console.log(JSON.stringify({ term, pncp: pncp.length }));
  }

  // Preço de referência por serviço de TI (Compras.gov.br, Pesquisa de Preço) -- catálogo fixo
  // de códigos CATSER, não termo livre (a API real não tem busca textual pra serviço).
  for (const categoria of CATSER_CATALOG) {
    const precos = await consultarPrecoServico(categoria.codigoItemCatalogo, config);
    await saveServicePrices(categoria.key, precos);
    console.log(JSON.stringify({ categoria: categoria.key, precos: precos.length }));
  }
} finally {
  await closeDatabase();
}