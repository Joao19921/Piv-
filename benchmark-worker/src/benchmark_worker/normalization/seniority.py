"""Normalizacao de senioridade para um vocabulario controlado.

Nao inventa: um texto que nao case com nenhuma palavra-chave conhecida vira
"unknown", e o chamador (normalizer.py) usa isso para reduzir a confianca da
observacao em vez de arriscar um palpite (ver PLANO-BENCHMARK-WORKER.md,
secao "Normalizacao").
"""

from __future__ import annotations

_SENIORITY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "estagio": ("intern", "estagiario", "estagiário", "estagio", "estágio", "trainee"),
    "junior": ("junior", "júnior", "jr", "entry level", "entry-level", "iniciante"),
    "pleno": ("pleno", "mid-level", "mid level", "intermediate", "intermediario"),
    "senior": ("senior", "sênior", "sr"),
    "especialista": (
        "especialista", "specialist", "staff", "principal", "lead", "expert", "arquiteto",
    ),
}


def normalize_seniority(raw: str | None) -> tuple[str, bool]:
    """Retorna (valor canonico, se foi reconhecido).

    O segundo valor existe para o chamador decidir o quanto reduzir a confianca --
    "unknown" reconhecido explicitamente no texto (ex.: fonte que ja diz "nivel nao
    informado") e diferente de um texto vazio ou de uma palavra que nao reconhecemos.
    """

    if not raw or not raw.strip():
        return "unknown", False

    lowered = raw.strip().lower()
    for canonical, keywords in _SENIORITY_KEYWORDS.items():
        if any(keyword in lowered for keyword in keywords):
            return canonical, True
    return "unknown", False
