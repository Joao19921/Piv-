"""Ponto de entrada do worker.

Dois subcomandos:

  run          -- le a configuracao, carrega o catalogo de fontes/perfis do Postgres
                  e executa um lote com todos os perfis ativos como uma unica
                  execucao persistida. Adapters reais entram na Fase 6, um por vez --
                  hoje as tres fontes automatizaveis estao DISABLED (Fase 1), entao
                  esta execucao sempre reporta SUCCESS sem observacoes ate que alguma
                  seja autorizada. E' o que o agendamento (Fase 7) chama.

  manual-entry -- registra uma unica observacao que uma pessoa leu numa fonte publica
                  legitima (ex.: guia salarial da Robert Half) -- nunca automacao. Ver
                  benchmark_worker.manual_entry e docs/BENCHMARK-WORKER-MANUAL.md.

Em ambos os casos, quem decide o que coletar e' o worker; o frontend do Pivo nunca
inicia uma coleta nem grava direto no banco de benchmark.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date

from benchmark_worker.config import WorkerConfig
from benchmark_worker.domain.errors import BenchmarkWorkerError
from benchmark_worker.extractors.generic import JsonListExtractor
from benchmark_worker.infrastructure.catalog import build_adapters, load_active_profiles, load_source_rows
from benchmark_worker.infrastructure.postgres_repository import PostgresRepository
from benchmark_worker.logging_utils import configure_logging
from benchmark_worker.manual_entry import ManualEntryInput, register_manual_entry
from benchmark_worker.normalization.normalizer import SalaryObservationNormalizer
from benchmark_worker.normalization.validator import SalaryObservationValidator
from benchmark_worker.runner import SourcePipeline, WorkerRunner

logger = logging.getLogger(__name__)


def _require_dsn() -> str:
    dsn = os.environ.get("BENCHMARK_WORKER_DATABASE_URL")
    if not dsn:
        logger.error(
            "BENCHMARK_WORKER_DATABASE_URL nao configurado -- nada a fazer "
            "(ver benchmark-worker/.env.example)"
        )
        raise SystemExit(1)
    return dsn


def run_collection(_args: argparse.Namespace) -> None:
    config = WorkerConfig.from_env()
    configure_logging(config.log_level)
    dsn = _require_dsn()

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


def manual_entry(args: argparse.Namespace) -> None:
    config = WorkerConfig.from_env()
    configure_logging(config.log_level)
    dsn = _require_dsn()

    entry = ManualEntryInput(
        role_title=args.role,
        source_reference=args.reference,
        salary_text=args.salary,
        observed_at=date.fromisoformat(args.observed_at),
        seniority_text=args.seniority,
        state_text=args.state,
        regime_text=args.regime,
    )

    try:
        register_manual_entry(dsn, entry)
    except BenchmarkWorkerError as error:
        logger.error("registro manual rejeitado: %s", error)
        raise SystemExit(1) from error


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="benchmark-worker")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("run", help="executa a coleta agendada/em lote").set_defaults(func=run_collection)

    manual = subparsers.add_parser(
        "manual-entry",
        help="registra uma observacao lida manualmente de uma fonte publica legitima (nunca automacao)",
    )
    manual.add_argument("--role", required=True, help='cargo, ex.: "Analista de BI"')
    manual.add_argument(
        "--reference",
        required=True,
        help="URL ou identificacao exata da pagina/relatorio consultado (referencia auditavel obrigatoria)",
    )
    manual.add_argument("--salary", required=True, help='texto do valor, ex.: "R$ 10.000 - R$ 15.000 por mes"')
    manual.add_argument("--observed-at", required=True, help="data da observacao, AAAA-MM-DD")
    manual.add_argument("--seniority", default=None, help='ex.: "Senior"')
    manual.add_argument("--state", default=None, help="UF, ex.: SP")
    manual.add_argument("--regime", default=None, help='ex.: "CLT" ou "PJ"')
    manual.set_defaults(func=manual_entry)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])
    args.func(args)


if __name__ == "__main__":
    main()
