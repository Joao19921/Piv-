from datetime import date, datetime, timezone

import pytest

from benchmark_worker.domain.errors import ValidationError
from benchmark_worker.domain.models import Currency, EmploymentRegime, Periodicity, SalaryObservation, SourceName
from benchmark_worker.normalization.validator import SalaryObservationValidator

VALIDATOR = SalaryObservationValidator()


def _observation(**overrides) -> SalaryObservation:
    base = dict(
        source=SourceName.INDEED,
        source_reference="ref-1",
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
    base.update(overrides)
    return SalaryObservation(**base)


def test_observacao_valida_passa():
    VALIDATOR.validate(_observation())  # nao deve levantar


def test_rejeita_cargo_vazio():
    with pytest.raises(ValidationError):
        VALIDATOR.validate(_observation(role_title="  "))


def test_rejeita_sem_nenhum_valor_salarial():
    with pytest.raises(ValidationError):
        VALIDATOR.validate(_observation(salary_min=None, salary_max=None))


def test_rejeita_min_maior_que_max():
    with pytest.raises(ValidationError):
        VALIDATOR.validate(_observation(salary_min=20000.0, salary_max=10000.0))


def test_rejeita_salario_nao_positivo():
    with pytest.raises(ValidationError):
        VALIDATOR.validate(_observation(salary_min=0.0, salary_max=0.0))


def test_rejeita_uf_invalida():
    with pytest.raises(ValidationError):
        VALIDATOR.validate(_observation(state="XX"))


def test_aceita_uf_desconhecida_como_none():
    VALIDATOR.validate(_observation(state=None))  # nao deve levantar


def test_rejeita_confianca_fora_do_intervalo():
    with pytest.raises(ValidationError):
        VALIDATOR.validate(_observation(confidence=1.5))
