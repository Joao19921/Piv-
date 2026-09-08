/**
 * Interpreta um número digitado livremente, aceitando tanto o formato BR ("15.500,50", ponto
 * milhar/vírgula decimal) quanto o formato simples usado internamente ("15500", "1.42").
 *
 * Sem isso, `Number("15.500")` (usuário digitando quinze mil e quinhentos do jeito brasileiro)
 * vira 15.5 — 1000x menor — e `Number("1,42")` vira NaN, quebrando silenciosamente qualquer
 * cálculo em cascata (custo mensal, custo-hora, taxa sugerida) sem nenhum aviso na tela.
 */
export function parseLocaleNumber(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  if (trimmed.includes(",")) {
    // Com vírgula presente, todo ponto antes dela é separador de milhar (ex: "15.500,50").
    const normalized = trimmed.replace(/\./g, "").replace(",", ".");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : 0;
  }

  // Sem vírgula: ponto seguido de grupos de exatos 3 dígitos até o fim é milhar (ex: "15.500",
  // "1.200.000"); qualquer outro uso de ponto é separador decimal (ex: "1.42", "0.5").
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    const value = Number(trimmed.replace(/\./g, ""));
    return Number.isFinite(value) ? value : 0;
  }

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : 0;
}
