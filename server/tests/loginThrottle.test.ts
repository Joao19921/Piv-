import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCK_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  recordFailure,
  recordSuccess,
  remainingLockMs,
  resetThrottleState,
} from "../src/infrastructure/auth/loginThrottle";

const EMAIL = "alvo@exemplo.com";

beforeEach(() => {
  resetThrottleState();
});

describe("loginThrottle", () => {
  it("nao bloqueia antes do limite de tentativas", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      expect(recordFailure(EMAIL)).toBe(false);
    }
    expect(remainingLockMs(EMAIL)).toBe(0);
  });

  it("bloqueia exatamente na enesima falha e sinaliza o evento", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) recordFailure(EMAIL);
    expect(recordFailure(EMAIL)).toBe(true);
    expect(remainingLockMs(EMAIL)).toBeGreaterThan(0);
    expect(remainingLockMs(EMAIL)).toBeLessThanOrEqual(LOCK_DURATION_MS);
  });

  it("login bem-sucedido zera o contador", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) recordFailure(EMAIL);
    recordSuccess(EMAIL);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      expect(recordFailure(EMAIL)).toBe(false);
    }
  });

  it("o bloqueio expira sozinho depois da duracao", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) recordFailure(EMAIL);
    expect(remainingLockMs(EMAIL)).toBeGreaterThan(0);
    // Consulta "do futuro" em vez de esperar de verdade: o modulo aceita `now` injetado.
    expect(remainingLockMs(EMAIL, Date.now() + LOCK_DURATION_MS + 1_000)).toBe(0);
  });

  it("falhas espacadas alem da janela nao somam ate travar a conta", () => {
    const t0 = Date.now();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) recordFailure(EMAIL, t0);
    // Uma falha muito depois reinicia a contagem em vez de fechar o bloqueio.
    expect(recordFailure(EMAIL, t0 + LOCK_DURATION_MS + 60_000)).toBe(false);
  });

  it("conta por e-mail normalizado (maiuscula e espaco nao driblam o bloqueio)", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) recordFailure(EMAIL);
    expect(recordFailure(`  ${EMAIL.toUpperCase()}  `)).toBe(true);
    expect(remainingLockMs(EMAIL)).toBeGreaterThan(0);
  });

  // O ponto central do desenho: contar em memoria por e-mail, exista a conta ou nao, e o que
  // evita que a diferenca entre 401 e 429 revele quais e-mails existem no sistema.
  it("trata e-mail inexistente igual a um existente", () => {
    const inexistente = "ninguem-aqui@exemplo.com";
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) recordFailure(inexistente);
    expect(recordFailure(inexistente)).toBe(true);
    expect(remainingLockMs(inexistente)).toBeGreaterThan(0);
  });
});
