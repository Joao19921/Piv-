"""Logging seguro do worker.

Regra da Fase 1: nenhum log deste worker pode conter segredo, credencial,
cookie, token ou dado pessoal. ``redact`` existe como uma segunda camada de
protecao para quando dicionarios de contexto sao logados diretamente -- ela
nao substitui a responsabilidade de nunca colocar esses valores em log.
"""

from __future__ import annotations

import logging
from typing import Any

_SENSITIVE_KEY_MARKERS = (
    "password",
    "senha",
    "secret",
    "token",
    "cookie",
    "session",
    "api_key",
    "apikey",
    "authorization",
    "credential",
)

_REDACTED = "***"


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def redact(context: dict[str, Any]) -> dict[str, Any]:
    """Retorna uma copia de ``context`` com valores de chaves sensiveis ocultos."""

    def is_sensitive(key: str) -> bool:
        lowered = key.lower()
        return any(marker in lowered for marker in _SENSITIVE_KEY_MARKERS)

    return {
        key: (_REDACTED if is_sensitive(key) else value)
        for key, value in context.items()
    }
