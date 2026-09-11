"""Parsing de texto salarial livre para valor(es), moeda e periodicidade.

Regra de ouro (PLANO-BENCHMARK-WORKER.md, secao "Qualidade dos dados"): registrar a
periodicidade tal como a fonte informou, nunca converter anual para mensal (ou
vice-versa) silenciosamente. "R$ 144.000 por ano" fica com periodicity=annual, nao
vira R$ 12.000/mes por conta propria.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_NUMBER_RE = re.compile(r"[\d][\d.,]*")

_ANNUAL_KEYWORDS = ("ano", "anual", "year", "yearly", "/yr", "annum", "a.a")
_MONTHLY_KEYWORDS = ("mes", "mês", "mensal", "month", "monthly", "/mo")
_USD_KEYWORDS = ("us$", "usd", "u$")
_BRL_KEYWORDS = ("r$", "brl", "reais")


@dataclass(frozen=True)
class ParsedSalary:
    salary_min: float | None
    salary_max: float | None
    currency: str  # "brl" | "usd" | "unknown"
    periodicity: str  # "monthly" | "annual" | "unknown"


def _parse_number(token: str) -> float | None:
    cleaned = token.strip()
    if not cleaned:
        return None

    has_dot = "." in cleaned
    has_comma = "," in cleaned

    if has_dot and has_comma:
        # O separador que aparece por ultimo e o decimal; o outro e milhar.
        # BR (10.000,50): "," depois do "." -> "." e milhar, "," e decimal.
        # US (10,000.50): o inverso.
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif has_comma:
        # So virgula: 3 digitos depois dela e quase sempre milhar ("5,000"), nao
        # decimal -- um salario com centavos em texto informal e raro.
        after = cleaned.rsplit(",", 1)[1]
        cleaned = cleaned.replace(",", "") if len(after) == 3 else cleaned.replace(",", ".")
    elif has_dot:
        # So ponto: mesma logica ("10.000" e milhar, nao 10.0).
        after = cleaned.rsplit(".", 1)[1]
        if len(after) == 3:
            cleaned = cleaned.replace(".", "")

    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_salary_text(raw: str) -> ParsedSalary:
    text = (raw or "").strip()
    lowered = text.lower()

    if any(keyword in lowered for keyword in _USD_KEYWORDS):
        currency = "usd"
    elif any(keyword in lowered for keyword in _BRL_KEYWORDS):
        currency = "brl"
    else:
        currency = "unknown"

    if any(keyword in lowered for keyword in _ANNUAL_KEYWORDS):
        periodicity = "annual"
    elif any(keyword in lowered for keyword in _MONTHLY_KEYWORDS):
        periodicity = "monthly"
    else:
        periodicity = "unknown"

    numbers = [n for n in (_parse_number(match) for match in _NUMBER_RE.findall(text)) if n is not None and n > 0]

    if not numbers:
        return ParsedSalary(None, None, currency, periodicity)
    if len(numbers) == 1:
        return ParsedSalary(numbers[0], numbers[0], currency, periodicity)
    return ParsedSalary(min(numbers), max(numbers), currency, periodicity)
