/**
 * Bloqueio de conta por tentativas de login malsucedidas.
 *
 * Complementa o rate limit por IP (`express-rate-limit`, em authRoutes): o limite por IP segura
 * a rajada vinda de um endereco so, e este aqui segura o ataque distribuido contra UMA conta,
 * que passaria pelo limite por IP sem esforco.
 *
 * ## Por que a contagem e em memoria e por e-mail, e nao so no banco
 *
 * O contador duravel vive em `users.failed_login_attempts` / `users.locked_until` (migration
 * 0008) e sobrevive a restart -- o que importa no Render Free, que reinicia sozinho. Mas ele so
 * existe para conta que existe. Se o bloqueio dependesse apenas dele, um e-mail inexistente
 * responderia 401 para sempre enquanto um e-mail real passaria a responder 429 depois de N
 * tentativas: a diferenca entre as duas respostas viraria um oraculo de enumeracao, dizendo ao
 * atacante exatamente quais e-mails existem.
 *
 * Por isso a contagem em memoria abaixo e feita por e-mail NORMALIZADO, exista a conta ou nao.
 * As duas situacoes passam a responder igual, e o oraculo desaparece.
 */
import { logger } from "../observability/logger";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;
/** Janela de esquecimento: falhas isoladas e espacadas nao devem somar ate travar a conta. */
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

interface AttemptState {
  failures: number;
  firstFailureAt: number;
  lockedUntil?: number;
}

const attempts = new Map<string, AttemptState>();

/** Teto de chaves: sem isso, um atacante trocando o e-mail a cada tentativa faz o Map crescer
 * sem limite e derruba o processo por memoria. Ao estourar, descarta as entradas mais antigas. */
const MAX_TRACKED_EMAILS = 10_000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function prune(now: number): void {
  for (const [key, state] of attempts) {
    const expired = (state.lockedUntil === undefined || state.lockedUntil <= now) && now - state.firstFailureAt > ATTEMPT_WINDOW_MS;
    if (expired) attempts.delete(key);
  }
  if (attempts.size > MAX_TRACKED_EMAILS) {
    const excess = attempts.size - MAX_TRACKED_EMAILS;
    let removed = 0;
    for (const key of attempts.keys()) {
      attempts.delete(key);
      if (++removed >= excess) break;
    }
  }
}

/** Milissegundos restantes de bloqueio, ou 0 se a conta nao esta bloqueada. */
export function remainingLockMs(email: string, now = Date.now()): number {
  const state = attempts.get(normalizeEmail(email));
  if (!state?.lockedUntil) return 0;
  return state.lockedUntil > now ? state.lockedUntil - now : 0;
}

/** Registra uma falha e devolve true se ESTA falha fechou o bloqueio (para auditar o evento). */
export function recordFailure(email: string, now = Date.now()): boolean {
  const key = normalizeEmail(email);
  prune(now);

  const state = attempts.get(key);
  if (!state || now - state.firstFailureAt > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { failures: 1, firstFailureAt: now });
    return false;
  }

  state.failures += 1;
  if (state.failures >= MAX_FAILED_ATTEMPTS && !state.lockedUntil) {
    state.lockedUntil = now + LOCK_DURATION_MS;
    logger.warn("Conta bloqueada temporariamente por tentativas de login malsucedidas", {
      // Nao logamos o e-mail inteiro: o log/Sentry nao precisa do dado pessoal para ser util.
      emailHint: `${key.slice(0, 2)}***@${key.split("@")[1] ?? "?"}`,
      failures: state.failures,
      lockMinutes: LOCK_DURATION_MS / 60_000,
    });
    return true;
  }
  return false;
}

export function recordSuccess(email: string): void {
  attempts.delete(normalizeEmail(email));
}

/** Só para os testes: zera o estado entre casos. */
export function resetThrottleState(): void {
  attempts.clear();
}
