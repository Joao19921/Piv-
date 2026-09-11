import { describe, expect, it } from "vitest";
import { isAllowedManualSourceReference } from "../src/domain/services/benchmarkSourceValidation";

describe("Validação de referência pública autorizada", () => {
  it("aceita URLs públicas e reconhecidas de fontes legítimas", () => {
    expect(isAllowedManualSourceReference("https://www.roberthalf.com/br/pt/insights/guia-salarial/tecnologia")).toBe(true);
    expect(isAllowedManualSourceReference("https://www.salary.com/research/salary?job=senior+data+analyst")).toBe(true);
    expect(isAllowedManualSourceReference("Mercer Total Remuneration Survey")).toBe(true);
  });

  it("rejeita URLs arbitrárias e lead-gen", () => {
    expect(isAllowedManualSourceReference("https://example.com/guia-salarial")).toBe(false);
    expect(isAllowedManualSourceReference("https://www.michaelpage.com.br/pt/job/analista-de-bi")).toBe(false);
    expect(isAllowedManualSourceReference("https://www.hays.com.br")).toBe(false);
    expect(isAllowedManualSourceReference("https://www.catho.com.br")).toBe(false);
  });
});
