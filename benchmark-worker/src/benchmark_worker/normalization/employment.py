"""Deteccao de regime de contratacao (CLT/PJ) a partir de texto da fonte.

Nunca infere: sem palavra-chave reconhecida, o regime fica "unknown" (ver
PLANO-BENCHMARK-WORKER.md: "Nao inferir CLT/PJ sem evidencia").
"""

from __future__ import annotations

_PJ_KEYWORDS = ("pj", "pessoa juridica", "pessoa jurídica", "contractor", "freelance", "freela")
_CLT_KEYWORDS = ("clt", "carteira assinada", "employee", "full-time", "full time", "funcionario", "funcionário")


def normalize_regime(raw: str | None) -> str:
    if not raw or not raw.strip():
        return "unknown"

    lowered = raw.strip().lower()
    if any(keyword in lowered for keyword in _PJ_KEYWORDS):
        return "pj"
    if any(keyword in lowered for keyword in _CLT_KEYWORDS):
        return "clt"
    return "unknown"
