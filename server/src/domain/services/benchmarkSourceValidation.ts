const BLOCKED_PATTERNS = [
  "catho",
  "michael page",
  "hays",
  "glassdoor",
  "indeed",
  "infojobs",
  "linkedin",
  "ziprecruiter",
  "jobstreet",
  "seek",
];

const ALLOWED_DOMAINS = [
  "roberthalf.com",
  "salary.com",
  "mercer.com",
  "aon.com",
];

const ALLOWED_LABELS = [
  "robert half",
  "salary.com",
  "mercer",
  "total remuneration survey",
  "aon",
];

export function isAllowedManualSourceReference(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();

  if (BLOCKED_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return false;
  }

  if (ALLOWED_LABELS.some((pattern) => lower.includes(pattern))) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
