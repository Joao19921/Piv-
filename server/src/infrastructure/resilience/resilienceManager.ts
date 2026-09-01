export type ServiceStatus = "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE";

export interface ResilienceResult<T> {
  status: ServiceStatus;
  source: string;
  timestamp: string;
  data: T | null;
  warning?: string;
}

interface CachedValue<T> {
  data: T;
  updatedAt: string;
}

/** Circuit breaker in-memory por serviço: abre após N falhas seguidas, meio-abre após o cooldown. */
class CircuitBreaker {
  private failures = new Map<string, number>();
  private openedAt = new Map<string, number>();

  constructor(
    private readonly failMax = 3,
    private readonly resetTimeoutMs = 60_000,
  ) {}

  isOpen(serviceName: string): boolean {
    const openedAt = this.openedAt.get(serviceName);
    if (openedAt === undefined) return false;
    if (Date.now() - openedAt > this.resetTimeoutMs) {
      // Half-open: permite uma nova tentativa.
      this.openedAt.delete(serviceName);
      this.failures.set(serviceName, 0);
      return false;
    }
    return true;
  }

  recordSuccess(serviceName: string): void {
    this.failures.set(serviceName, 0);
    this.openedAt.delete(serviceName);
  }

  recordFailure(serviceName: string): void {
    const count = (this.failures.get(serviceName) ?? 0) + 1;
    this.failures.set(serviceName, count);
    if (count >= this.failMax) {
      this.openedAt.set(serviceName, Date.now());
    }
  }
}

const circuitBreaker = new CircuitBreaker(2, 30_000);

async function retryWithBackoff<T>(fn: () => Promise<T>, attempts = 2, baseMs = 300): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        const waitMs = baseMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }
  throw lastError;
}

/**
 * Executa `primary` protegido por circuit breaker + retry exponencial. Se o circuito estiver
 * aberto ou todas as tentativas falharem, recorre a `fallback` (Camada 3/4 da matriz de resiliência).
 */
export async function executeWithFallback<T>(options: {
  serviceName: string;
  primary: () => Promise<T>;
  fallback: () => Promise<CachedValue<T> | null>;
  retryAttempts?: number;
}): Promise<ResilienceResult<T>> {
  const { serviceName, primary, fallback, retryAttempts = 2 } = options;

  if (circuitBreaker.isOpen(serviceName)) {
    return resolveFallback(serviceName, fallback, `Circuito aberto para ${serviceName}; usando dado em cache/fallback.`);
  }

  try {
    const data = await retryWithBackoff(primary, retryAttempts);
    circuitBreaker.recordSuccess(serviceName);
    return {
      status: "OPERATIONAL",
      source: "LIVE_API",
      timestamp: new Date().toISOString(),
      data,
    };
  } catch (err) {
    circuitBreaker.recordFailure(serviceName);
    const reason = err instanceof Error ? err.message : String(err);
    return resolveFallback(serviceName, fallback, `Serviço ${serviceName} indisponível (${reason}). Ativando fallback.`);
  }
}

async function resolveFallback<T>(
  serviceName: string,
  fallback: () => Promise<CachedValue<T> | null>,
  warning: string,
): Promise<ResilienceResult<T>> {
  try {
    const cached = await fallback();
    if (cached) {
      return {
        status: "FALLBACK_STALE",
        source: "LOCAL_CACHE",
        timestamp: cached.updatedAt,
        warning,
        data: cached.data,
      };
    }
  } catch {
    /* fallback também falhou; cai para OFFLINE abaixo */
  }

  return {
    status: "OFFLINE",
    source: "NONE",
    timestamp: new Date().toISOString(),
    warning: `${warning} Nenhum dado de contingência disponível.`,
    data: null,
  };
}
