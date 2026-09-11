from datetime import date

import pytest

from benchmark_worker.domain.errors import ValidationError
from benchmark_worker.domain.models import RunStatus, SourceName
from benchmark_worker.manual_entry import ManualEntryInput, register_manual_entry


class _FakeRepository:
    def __init__(self) -> None:
        self.saved = []

    def save_run_summary(self, summary):
        self.saved.append(summary)


def _entry(**overrides) -> ManualEntryInput:
    base = dict(
        role_title="Analista de BI",
        source_reference="https://www.roberthalf.com/br/pt/insights/guia-salarial/tecnologia",
        salary_text="R$ 10.000 - R$ 15.000 por mes",
        observed_at=date(2026, 9, 11),
        seniority_text="Senior",
        state_text="SP",
        regime_text="CLT",
    )
    base.update(overrides)
    return ManualEntryInput(**base)


def test_registra_observacao_manual_com_sucesso():
    repository = _FakeRepository()
    summary = register_manual_entry("dsn-nao-usado", _entry(), repository=repository)

    assert len(repository.saved) == 1
    assert summary.status == RunStatus.SUCCESS
    assert summary.triggered_by == "manual"
    result = summary.results[0]
    assert result.source == SourceName.MANUAL
    assert len(result.observations) == 1
    assert result.observations[0].salary_min == 10000.0


def test_rejeita_referencia_vazia():
    repository = _FakeRepository()
    with pytest.raises(ValidationError):
        register_manual_entry("dsn-nao-usado", _entry(source_reference=""), repository=repository)
    assert repository.saved == []


def test_rejeita_sem_valor_salarial_reconhecido():
    repository = _FakeRepository()
    with pytest.raises(ValidationError):
        register_manual_entry("dsn-nao-usado", _entry(salary_text="a combinar"), repository=repository)
    assert repository.saved == []
