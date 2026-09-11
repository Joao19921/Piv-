"""Ponto de entrada do worker.

Le a configuracao, carrega o catalogo de fontes/perfis do Postgres e executa um lote
com todos os perfis ativos como uma unica execucao persistida. Adapters reais entram
na Fase 6, um por vez -- hoje as tres fontes estao DISABLED (Fase 1), entao esta
execucao sempre reporta SUCCESS sem observacoes ate que alguma seja autorizada.

Modos de execucao (ver docs/FASE-2-ARQUITETURA-BENCHMARK-WORKER.md):
  manual    -- disparo local por um humano (linha de comando) ou pelo admin (Fase 6).
  scheduled -- disparo pelo agendador (GitHub Actions, Fase 7).
Em ambos os casos, quem decide o que coletar e o worker; o frontend do Pivo nunca
inicia uma coleta diretamente.
"""

from __future__ import annotations

import logging
import os

from benchmark_worker.config import WorkerConfig
from benchmark_worker.extractors.generic import JsonListExtractor
from benchmark_worker.infrastructure.catalog import build_adapters, load_active_profiles, load_source_rows
from benchmark_worker.infrastructure.postgres_repository import PostgresRepository
from benchmark_worker.logging_utils import configure_logging
from benchmark_worker.normalization.normalizer import SalaryObservationNormalizer
from benchmark_worker.normalization.validator import SalaryObservationValidator
from benchmark_worker.runner import SourcePipeline, WorkerRunner

logger = logging.getLogger(__name__)


def main() -> None:
    config = WorkerConfig.from_env()
    configure_logging(config.log_level)

    dsn = os.environ.get("BENCHMARK_WORKER_DATABASE_URL")
    if not dsn:
        logger.error(
            "BENCHMARK_WORKER_DATABASE_URL nao configurado -- nada a fazer "
            "(ver benchmark-worker/.env.example)"
        )
        raise SystemExit(1)

    source_rows = load_source_rows(dsn)
    pipelines = [
        SourcePipeline(
            adapter=adapter,
            extractor=JsonListExtractor(),
            normalizer=SalaryObservationNormalizer(),
            validator=SalaryObservationValidator(),
        )
        for adapter in build_adapters(source_rows)
    ]

    requests = load_active_profiles(dsn)
    if not requests:
        logger.warning("nenhum benchmark_profiles ativo -- nada a coletar")
        return

    runner = WorkerRunner(config=config, pipelines=pipelines, repository=PostgresRepository(dsn))
    summary = runner.run_batch(requests)

    logger.info(
        "execucao concluida: status=%s perfis=%d fontes=%s",
        summary.status.value,
        len(requests),
        [(r.source.value, r.status.value, len(r.observations)) for r in summary.results],
    )


if __name__ == "__main__":
    main()
