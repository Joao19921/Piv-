"""Orquestrador do pipeline do worker.

Liga os contratos definidos em ``benchmark_worker.domain.contracts``. Fixtures/fakes
que exercitam este fluxo de ponta a ponta estao em ``tests/``; adapters reais entram
na Fase 6, um por vez, somente apos autorizacao documentada.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from benchmark_worker.config import WorkerConfig
from benchmark_worker.domain.contracts import (
    Adapter,
    CollectionRequest,
    Extractor,
    Normalizer,
    Repository,
    Validator,
)
from benchmark_worker.domain.errors import AdapterDisabledError
from benchmark_worker.domain.models import RunStatus, RunSummary, SalaryObservation, SourceRunResult
from benchmark_worker.retry import retry_with_backoff, run_isolated

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SourcePipeline:
    """As pecas do pipeline para uma unica fonte."""

    adapter: Adapter
    extractor: Extractor
    normalizer: Normalizer
    validator: Validator


class WorkerRunner:
    def __init__(
        self,
        config: WorkerConfig,
        pipelines: list[SourcePipeline],
        repository: Repository,
    ) -> None:
        self._config = config
        self._pipelines = pipelines
        self._repository = repository

    def run_once(self, request: CollectionRequest) -> RunSummary:
        """Executa uma unica solicitacao de coleta. Atalho de ``run_batch`` com uma
        solicitacao so -- util para testes e para um disparo manual pontual (Fase 6)."""
        return self.run_batch([request])

    def run_batch(self, requests: list[CollectionRequest]) -> RunSummary:
        """Executa um lote de solicitacoes (ex.: todos os `benchmark_profiles` ativos)
        como uma unica execucao persistida (uma linha em `benchmark_runs`)."""
        started_at = datetime.now(timezone.utc)
        results = [self._run_source(pipeline, requests) for pipeline in self._pipelines]
        summary = RunSummary(
            started_at=started_at,
            finished_at=datetime.now(timezone.utc),
            triggered_by=self._config.run_mode.value,
            results=tuple(results),
        )
        self._repository.save_run_summary(summary)
        return summary

    def _run_source(self, pipeline: SourcePipeline, requests: list[CollectionRequest]) -> SourceRunResult:
        source = pipeline.adapter.source

        # O contrato do Adapter (domain/contracts.py) promete que uma fonte DISABLED
        # nunca e chamada -- checar aqui, antes de qualquer tentativa/retry, em vez de
        # deixar o fetch levantar AdapterDisabledError e ser tratado como falha comum.
        if pipeline.adapter.status.value == "disabled":
            logger.info("fonte %s desabilitada -- pulando sem tentar", source.value)
            return SourceRunResult(
                source=source,
                status=RunStatus.DISABLED,
                observations=(),
                error_summary=None,
            )

        observations: list[SalaryObservation] = []
        failures = 0

        for request in requests:

            def collect(request: CollectionRequest = request) -> list[SalaryObservation]:
                raw_payload = retry_with_backoff(
                    lambda: pipeline.adapter.fetch(request),
                    max_retries=self._config.source_max_retries,
                    backoff_seconds=self._config.source_retry_backoff_seconds,
                )
                collected: list[SalaryObservation] = []
                for raw_observation in pipeline.extractor.extract(raw_payload):
                    observation = pipeline.normalizer.normalize(raw_observation)
                    pipeline.validator.validate(observation)
                    collected.append(observation)
                return collected

            per_request, error = run_isolated(source.value, collect)
            if error is not None:
                if isinstance(error, AdapterDisabledError):
                    # Uma fonte que era ENABLED no inicio do lote e fica DISABLED no meio
                    # (mudanca de configuracao concorrente) nao deve virar FAILED por isso.
                    continue
                failures += 1
                continue
            assert per_request is not None
            observations.extend(per_request)

        if failures == 0:
            status = RunStatus.SUCCESS
        elif failures < len(requests):
            status = RunStatus.PARTIAL
        else:
            status = RunStatus.FAILED

        return SourceRunResult(
            source=source,
            status=status,
            observations=tuple(observations),
            error_summary=f"{failures}/{len(requests)} solicitacoes falharam" if failures else None,
        )
