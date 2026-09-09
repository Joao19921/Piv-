/**
 * Politica de senha do Pivo.
 *
 * Antes existia uma unica regra, duplicada em dois lugares com textos diferentes:
 * `length >= 8` na troca de senha (`authRoutes`) e `length >= 8` na criacao de usuario pelo
 * admin (`adminUsersRoutes`). Oito caracteres sem nenhuma outra exigencia aceita "12345678" e
 * "senhasenha", que sao as primeiras entradas de qualquer wordlist de brute force.
 *
 * As regras abaixo seguem a linha do NIST SP 800-63B: comprimento e o fator que mais importa, e
 * barrar senha obvia vale mais do que exigir simbolo. Nao ha expiracao periodica obrigatoria --
 * o proprio NIST desaconselha, porque leva o usuario a rotacionar "Senha1" -> "Senha2".
 */

export const PASSWORD_MIN_LENGTH = 10;

/**
 * scrypt custa CPU proporcional ao tamanho da entrada; sem teto, uma senha de megabytes vira um
 * vetor barato de negacao de servico contra o proprio servidor no ato do login.
 */
const PASSWORD_MAX_LENGTH = 200;

/**
 * Bases obvias demais para serem aceitas. A comparacao NAO e por "contem" de proposito: `senha`
 * como substring reprovaria "MinhaSenhaForte!2026", que e uma senha boa, e treinaria o usuario a
 * contornar a regra. Comparamos com a senha inteira e com ela sem os digitos/simbolos do fim --
 * o que pega "senha", "senha123", "admin2026" e deixa passar quem so usou a palavra no meio de
 * algo maior.
 */
const OBVIOUS_PASSWORDS = new Set([
  "123456",
  "1234567890",
  "password",
  "senha",
  "senhasenha",
  "qwerty",
  "abc",
  "admin",
  "administrador",
  "pivo",
  "mudar",
  "trocar",
  "teste",
]);

export interface PasswordPolicyResult {
  ok: boolean;
  /** Mensagem pronta para o usuario final; `undefined` quando `ok` e true. */
  error?: string;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Valida uma senha nova. `context` traz dados do proprio usuario (nome, e-mail) para barrar
 * senha derivada deles -- a primeira coisa que alguem que conhece a vitima tenta.
 */
export function validatePassword(password: unknown, context: { name?: string; email?: string } = {}): PasswordPolicyResult {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.` };
  }

  const hasLetter = /\p{L}/u.test(password);
  const hasDigitOrSymbol = /[\p{N}\p{P}\p{S}]/u.test(password);
  if (!hasLetter || !hasDigitOrSymbol) {
    return { ok: false, error: "A senha precisa combinar letras com pelo menos um número ou símbolo." };
  }

  // "aaaaaaaaaa1" satisfaz tudo acima e nao tem entropia nenhuma.
  if (new Set(password).size < 5) {
    return { ok: false, error: "A senha repete caracteres demais. Use uma combinação mais variada." };
  }

  const normalized = normalize(password);
  // Tira digitos e simbolos do fim: "senha123" e "senha!" viram "senha".
  const base = normalized.replace(/[^\p{L}]+$/u, "");
  if (OBVIOUS_PASSWORDS.has(normalized) || OBVIOUS_PASSWORDS.has(base)) {
    return { ok: false, error: "Essa senha é previsível demais. Escolha outra, sem palavras óbvias." };
  }

  if (containsPersonalData(normalized, context)) {
    return { ok: false, error: "A senha não pode conter seu nome nem seu e-mail." };
  }

  return { ok: true };
}

/** Tamanho minimo de um pedaco de nome/e-mail para ser comparado: "Ana" ou "de" dentro de uma
 * senha qualquer daria falso positivo demais. */
const MIN_PERSONAL_TOKEN_LENGTH = 4;

/**
 * Compara a senha com o nome e o e-mail do usuario. Testa tanto o nome inteiro sem espacos
 * quanto cada parte dele isoladamente -- so a comparacao com a string inteira nao pega
 * "JoaoHenrique2026" para o usuario "Joao Henrique", porque a senha nao tem o espaco do meio.
 */
function containsPersonalData(normalizedPassword: string, context: { name?: string; email?: string }): boolean {
  const candidates: string[] = [];

  const name = context.name?.trim();
  if (name) {
    const normalizedName = normalize(name);
    candidates.push(normalizedName.replace(/\s+/g, ""));
    candidates.push(...normalizedName.split(/\s+/));
  }

  const localPart = context.email?.split("@")[0]?.trim();
  if (localPart) {
    const normalizedLocal = normalize(localPart);
    candidates.push(normalizedLocal);
    // "joao.henrique" / "joao_henrique" / "joao-henrique" viram partes separadas tambem.
    candidates.push(...normalizedLocal.split(/[^\p{L}\p{N}]+/u));
  }

  return candidates.some((candidate) => candidate.length >= MIN_PERSONAL_TOKEN_LENGTH && normalizedPassword.includes(candidate));
}
