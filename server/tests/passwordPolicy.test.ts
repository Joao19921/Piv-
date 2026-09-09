import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH, validatePassword } from "../src/domain/services/passwordPolicy";

describe("validatePassword", () => {
  it("aceita uma senha razoavel", () => {
    expect(validatePassword("Cavalo!Bateria9").ok).toBe(true);
    expect(validatePassword("orvalho-quente-42").ok).toBe(true);
  });

  it(`recusa abaixo de ${PASSWORD_MIN_LENGTH} caracteres`, () => {
    const result = validatePassword("Curta1!");
    expect(result.ok).toBe(false);
    expect(result.error).toContain(String(PASSWORD_MIN_LENGTH));
  });

  // Teto existe porque scrypt custa CPU proporcional ao tamanho da entrada: sem ele, uma senha
  // gigante e um jeito barato de derrubar o proprio servidor no ato do login.
  it("recusa senha absurdamente longa", () => {
    expect(validatePassword("a1".repeat(200)).ok).toBe(false);
  });

  it("exige letras combinadas com numero ou simbolo", () => {
    expect(validatePassword("somenteletras").ok).toBe(false);
    expect(validatePassword("1234567890123").ok).toBe(false);
  });

  it("recusa senha com pouquissima variedade de caracteres", () => {
    expect(validatePassword("aaaaaaaaaa1").ok).toBe(false);
  });

  it("recusa as senhas obvias, inclusive com digitos no fim", () => {
    expect(validatePassword("senha123456").ok).toBe(false);
    expect(validatePassword("password12").ok).toBe(false);
    expect(validatePassword("administrador1").ok).toBe(false);
  });

  // A comparacao com a lista de obvias e por igualdade (e por "sem os digitos do fim"), nao por
  // "contem" -- senao uma senha boa como esta seria reprovada e o usuario aprenderia a burlar a
  // regra em vez de escolher melhor.
  it("aceita senha boa que apenas contem uma palavra comum no meio", () => {
    expect(validatePassword("MinhaSenhaForte!2026").ok).toBe(true);
  });

  it("recusa senha derivada do nome ou do e-mail do proprio usuario", () => {
    expect(validatePassword("JoaoHenrique2026", { name: "Joao Henrique" }).ok).toBe(false);
    expect(validatePassword("jhcosta!2026", { email: "jhcosta@exemplo.com" }).ok).toBe(false);
  });

  it("nao reprova por causa de um nome curto demais para ser significativo", () => {
    expect(validatePassword("anacronico-77!", { name: "Ana" }).ok).toBe(true);
  });

  it("recusa valor que nem e string", () => {
    expect(validatePassword(undefined).ok).toBe(false);
    expect(validatePassword(12345678901).ok).toBe(false);
  });
});
