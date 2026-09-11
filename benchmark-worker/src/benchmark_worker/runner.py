"""Orquestrador do pipeline do worker (esqueleto da Fase 2).

Liga os contratos definidos em ``benchmark_worker.domain.contracts`` sem
nenhuma implementacao real de fonte. Fixtures/fakes que exercitam este fluxo
de ponta a ponta entram na Fase 4; adapters reais entram na Fase 6, um por
vez, somente apos autorizacao documentada.
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
        started_at = datetime.now(timezone.utc)
        results = [self._run_source(pipeline, request) for pipeline in self._pipelines]
        summary = RunSummary(
            started_at=started_at,
            finished_at=datetime.now(timezone.utc),
            results=tuple(results),
        )
        self._repository.save_run_summary(summary)
        return summary

    def _run_source(self, pipeline: SourcePipeline, request: CollectionRequest) -> SourceRunResult:
        source = pipeline.adapter.source

        def collect() -> list[SalaryObservation]:
            raw_payload = retry_with_backoff(
                lambda: pipeline.adapter.fetch(request),
                max_retries=self._config.source_max_retries,
                backoff_seconds=self._config.source_retry_backoff_seconds,
            )
            observations: list[SalaryObservation] = []
            for raw_observation in pipeline.extractor.extract(raw_payload):
                observation = pipeline.normalizer.normalize(raw_observation)
                pipeline.validator.validate(observation)
                observations.append(observation)
            return observations

        observations, error = run_isolated(source.value, collect)

        if error is not None:
            return SourceRunResult(
                source=source,
                status=RunStatus.FAILED,
                observations=(),
                error_summary=f"{type(error).__name__}: {error}",
            )

        assert observations is not None
        if observations:
            self._repository.save_observations(observations)
        return SourceRunResult(
            source=source,
            status=RunStatus.SUCCESS,
            observations=tuple(observations),
        )
