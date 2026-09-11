"""Retry com backoff e isolamento de falha por fonte.

A falha de uma fonte nunca deve interromper o processamento das demais (ver
Fase 5 do plano: "erro em uma fonte resulta em PARTIAL, sem impedir as
demais"). ``run_isolated`` e o ponto unico onde essa garantia e aplicada.
"""

from __future__ import annotations

import logging
import time
from typing import Callable, TypeVar

from benchmark_worker.domain.errors import AdapterDisabledError, SourceUnavailableError

logger = logging.getLogger(__name__)

T = TypeVar("T")


def retry_with_backoff(
    fn: Callable[[], T],
    *,
    max_retries: int,
    backoff_seconds: float,
    retryable: tuple[type[Exception], ...] = (SourceUnavailableError,),
) -> T:
    """Executa ``fn``, tentando novamente em erros retryable com backoff fixo.

    ``AdapterDisabledError`` nunca e retryable: reexecutar nao muda o estado
    de autorizacao de uma fonte.
    """

    attempt = 0
    while True:
        try:
            return fn()
        except retryable:
            attempt += 1
            if attempt > max_retries:
                raise
            time.sleep(backoff_seconds)


def run_isolated(source_name: str, fn: Callable[[], T]) -> tuple[T | None, Exception | None]:
    """Executa ``fn`` isolando qualquer excecao para nao afetar outras fontes.

    Retorna ``(resultado, None)`` em sucesso ou ``(None, excecao)`` em falha.
    O chamador decide como mapear a excecao para ``RunStatus`` (ver
    ``benchmark_worker.runner``).
    """

    try:
        return fn(), None
    except AdapterDisabledError as error:
        logger.info("fonte %s desabilitada: %s", source_name, error)
        return None, error
    except Exception as error:  # isolamento deliberado: nunca propagar entre fontes
        logger.warning("fonte %s falhou: %s", source_name, error)
        return None, error
