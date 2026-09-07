import { describe, expect, it } from "vitest";
import { hasPermission, isActive, isAdmin, type AuthenticatedUser } from "../src/domain/services/authorization";

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "1",
    name: "Teste",
    email: "teste@exemplo.com",
    role: "USER",
    status: "ACTIVE",
    mustChangePassword: false,
    permissions: [],
    ...overrides,
  };
}

describe("authorization", () => {
  it("ADMIN tem acesso a qualquer permissao, mesmo sem linhas cadastradas", () => {
    const admin = makeUser({ role: "ADMIN", permissions: [] });
    expect(isAdmin(admin)).toBe(true);
    expect(hasPermission(admin, "LABOR")).toBe(true);
    expect(hasPermission(admin, "INFRA")).toBe(true);
    expect(hasPermission(admin, "LICENSES")).toBe(true);
  });

  it("USER sem permissoes nao acessa nenhum modulo", () => {
    const user = makeUser({ permissions: [] });
    expect(hasPermission(user, "LABOR")).toBe(false);
    expect(hasPermission(user, "INFRA")).toBe(false);
    expect(hasPermission(user, "LICENSES")).toBe(false);
  });

  it("USER com LABOR+INFRA acessa so esses dois", () => {
    const user = makeUser({ permissions: ["LABOR", "INFRA"] });
    expect(hasPermission(user, "LABOR")).toBe(true);
    expect(hasPermission(user, "INFRA")).toBe(true);
    expect(hasPermission(user, "LICENSES")).toBe(false);
  });

  it("isActive reflete o status", () => {
    expect(isActive({ status: "ACTIVE" })).toBe(true);
    expect(isActive({ status: "INACTIVE" })).toBe(false);
  });
});
