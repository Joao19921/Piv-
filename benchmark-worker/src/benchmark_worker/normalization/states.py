"""Estados brasileiros suportados na V1 (26 estados + DF)."""

from __future__ import annotations

UFS = frozenset(
    {
        "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
        "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
    }
)


def normalize_state(raw: str | None) -> str | None:
    """Retorna a UF em maiusculo se for uma das 27 suportadas, senao None.

    Nao tenta adivinhar a partir do nome do estado ou de uma cidade -- so aceita a
    sigla, para nao inferir localidade sem seguranca (ver PLANO-BENCHMARK-WORKER.md,
    secao "O worker nao fara").
    """

    if not raw:
        return None
    candidate = raw.strip().upper()
    return candidate if candidate in UFS else None
