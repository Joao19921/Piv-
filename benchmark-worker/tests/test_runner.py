from datetime import date, datetime, timezone

from benchmark_worker.config import RunMode, WorkerConfig
from benchmark_worker.domain.contracts import Adapter, CollectionRequest, Extractor, Normalizer, RawPayload, Validator
from benchmark_worker.domain.errors import SourceUnavailableError
from benchmark_worker.domain.models import (
    AdapterStatus,
    Currency,
    EmploymentRegime,
    Periodicity,
    RunStatus,
    SalaryObservation,
    SourceName,
)
from benchmark_worker.runner import SourcePipeline, WorkerRunner


def _config() -> WorkerConfig:
    return WorkerConfig(
        env="test",
        log_level="INFO",
        run_mode=RunMode.MANUAL,
        source_timeout_seconds=1,
        source_max_retries=1,
        source_retry_backoff_seconds=0,
    )


def _observation(source: SourceName, reference: str) -> SalaryObservation:
    return SalaryObservation(
        source=source,
        source_reference=reference,
        role_title="Analista de BI",
        seniority="senior",
        state="SP",
        regime=EmploymentRegime.CLT,
        salary_min=10000.0,
        salary_max=15000.0,
        currency=Currency.BRL,
        periodicity=Periodicity.MONTHLY,
        observed_at=date(2026, 9, 1),
        confidence=0.9,
        collected_at=datetime.now(timezone.utc),
    )


class _FakeAdapter(Adapter):
    def __init__(self, source: SourceName, status: AdapterStatus, fails: bool = False) -> None:
        self.source = source
        self._status = status
        self._fails = fails
        self.fetch_calls = 0

    @property
    def status(self) -> AdapterStatus:
        return self._status

    def fetch(self, request: CollectionRequest) -> RawPayload:
        self.fetch_calls += 1
        if self._fails:
            raise SourceUnavailableError("indisponivel")
        return [{"role_title": request.role_title}]


class _PassthroughExtractor(Extractor):
    def extract(self, raw):
        return raw


class _FakeNormalizer(Normalizer):
    def __init__(self, source: SourceName) -> None:
        self._source = source

    def normalize(self, raw_observation):
        return _observation(self._source, raw_observation["role_title"])


class _NoopValidator(Validator):
    def validate(self, observation):
        return None


class _FakeRepository:
    def __init__(self) -> None:
        self.saved = []

    def save_run_summary(self, summary):
        self.saved.append(summary)


def _pipeline(source: SourceName, status: AdapterStatus, fails: bool = False) -> tuple[SourcePipeline, _FakeAdapter]:
    adapter = _FakeAdapter(source, status, fails=fails)
    return (
        SourcePipeline(
            adapter=adapter,
            extractor=_PassthroughExtractor(),
            normalizer=_FakeNormalizer(source),
            validator=_NoopValidator(),
        ),
        adapter,
    )


def test_fonte_desabilitada_nunca_chama_fetch():
    pipeline, adapter = _pipeline(SourceName.INDEED, AdapterStatus.DISABLED)
    repository = _FakeRepository()
    runner = WorkerRunner(config=_config(), pipelines=[pipeline], repository=repository)

    summary = runner.run_once(CollectionRequest(role_title="Analista de BI"))

    assert adapter.fetch_calls == 0
    assert summary.results[0].status == RunStatus.DISABLED
    # Todas desabilitadas => execucao geral SUCCESS, nao FAILED (nada realmente falhou).
    assert summary.status == RunStatus.SUCCESS
    assert len(repository.saved) == 1


def test_uma_fonte_falha_outra_funciona_da_partial():
    ok_pipeline, ok_adapter = _pipeline(SourceName.INDEED, AdapterStatus.ENABLED)
    failing_pipeline, failing_adapter = _pipeline(SourceName.GLASSDOOR, AdapterStatus.ENABLED, fails=True)
    repository = _FakeRepository()
    runner = WorkerRunner(config=_config(), pipelines=[ok_pipeline, failing_pipeline], repository=repository)

    summary = runner.run_once(CollectionRequest(role_title="Analista de BI"))

    by_source = {result.source: result for result in summary.results}
    assert by_source[SourceName.INDEED].status == RunStatus.SUCCESS
    assert len(by_source[SourceName.INDEED].observations) == 1
    assert by_source[SourceName.GLASSDOOR].status == RunStatus.FAILED
    assert summary.status == RunStatus.PARTIAL
    # max_retries=1 -> 2 tentativas
    assert failing_adapter.fetch_calls == 2


def test_run_batch_agrega_multiplos_perfis():
    pipeline, adapter = _pipeline(SourceName.INDEED, AdapterStatus.ENABLED)
    repository = _FakeRepository()
    runner = WorkerRunner(config=_config(), pipelines=[pipeline], repository=repository)

    requests = [
        CollectionRequest(role_title="Analista de BI"),
        CollectionRequest(role_title="Desenvolvedor Java"),
    ]
    summary = runner.run_batch(requests)

    assert adapter.fetch_calls == 2
    assert len(summary.results[0].observations) == 2
    assert summary.status == RunStatus.SUCCESS
    assert summary.triggered_by == "manual"
