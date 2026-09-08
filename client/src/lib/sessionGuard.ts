export const SESSION_EXPIRED_EVENT = "pivo:session-expired";

/**
 * Intercepta toda resposta 401 da API (fora do próprio /auth/login, onde 401 é só "senha
 * errada" e já tem tratamento local) e avisa o app pra voltar pra tela de login. Sem isso,
 * uma sessão invalidada em segundo plano (deploy sem SESSION_SECRET persistente, expiração,
 * desativação) deixava as telas girando em loop de erro 401 sem nenhuma saída visível pro
 * usuário — só um "tentei de novo e deu erro" sem contexto.
 */
export function installSessionGuard() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await originalFetch(...args);
    const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].toString() : (args[0] as Request).url;
    if (res.status === 401 && url.includes("/api/v1/") && !url.includes("/api/v1/auth/login")) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    return res;
  };
}
