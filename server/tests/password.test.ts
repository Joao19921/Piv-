import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/infrastructure/auth/password";

describe("password", () => {
  it("hasheia e verifica a senha correta", () => {
    const hash = hashPassword("uma-senha-forte-123");
    expect(hash).not.toContain("uma-senha-forte-123");
    expect(verifyPassword("uma-senha-forte-123", hash)).toBe(true);
  });

  it("rejeita senha incorreta", () => {
    const hash = hashPassword("uma-senha-forte-123");
    expect(verifyPassword("senha-errada", hash)).toBe(false);
  });

  it("gera hashes diferentes pra mesma senha (salt aleatorio)", () => {
    const hash1 = hashPassword("mesma-senha");
    const hash2 = hashPassword("mesma-senha");
    expect(hash1).not.toBe(hash2);
    expect(verifyPassword("mesma-senha", hash1)).toBe(true);
    expect(verifyPassword("mesma-senha", hash2)).toBe(true);
  });
});
