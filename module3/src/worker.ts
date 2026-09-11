import "dotenv/config";
import { getModule3Config } from "./config";
import { closeDatabase, saveSearch } from "./db";
import { searchComprasGov, searchPncp } from "./sources";

const terms = (process.env.MOD3_TERMS ?? "Desenvolvedor React,Consultoria SAP,Notebook i7")
  .split(",").map((term) => term.trim()).filter(Boolean);
const config = getModule3Config();

try {
  for (const term of terms) {
    const [pncp, comprasGov] = await Promise.all([searchPncp(term, config), searchComprasGov(term, config)]);
    await saveSearch(term, [...pncp, ...comprasGov]);
    console.log(JSON.stringify({ term, pncp: pncp.length, comprasGov: comprasGov.length }));
  }
} finally {
  await closeDatabase();
}