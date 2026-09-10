"""Configuracao do worker, lida apenas de variaveis de ambiente.

Nenhum valor default aqui deve habilitar acesso real a uma fonte -- isso
depende de configuracao explicita por adapter, adicionada somente apos
autorizacao documentada (Fase 1).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum


class RunMode(str, Enum):
    MANUAL = "manual"
    SCHEDULED = "scheduled"


@dataclass(frozen=True)
class WorkerConfig:
    env: str
    log_level: str
    run_mode: RunMode
    source_timeout_seconds: float
    source_max_retries: int
    source_retry_backoff_seconds: float

    @staticmethod
    def from_env() -> "WorkerConfig":
        return WorkerConfig(
            env=os.environ.get("BENCHMARK_WORKER_ENV", "local"),
            log_level=os.environ.get("BENCHMARK_WORKER_LOG_LEVEL", "INFO"),
            run_mode=RunMode(
                os.environ.get("BENCHMARK_WORKER_RUN_MODE", RunMode.MANUAL.value)
            ),
            source_timeout_seconds=float(
                os.environ.get("BENCHMARK_WORKER_SOURCE_TIMEOUT_SECONDS", "30")
            ),
            source_max_retries=int(
                os.environ.get("BENCHMARK_WORKER_SOURCE_MAX_RETRIES", "2")
            ),
            source_retry_backoff_seconds=float(
                os.environ.get("BENCHMARK_WORKER_SOURCE_RETRY_BACKOFF_SECONDS", "5")
            ),
        )
