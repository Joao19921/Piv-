from datetime import date

from benchmark_worker.domain.models import Currency, EmploymentRegime, Periodicity, SourceName
from benchmark_worker.normalization.normalizer import SalaryObservationNormalizer

NORMALIZER = SalaryObservationNormalizer()


def _raw(**overrides):
    base = {
        "source": SourceName.INDEED,
        "source_reference": "https://example.invalid/agg/123",
        "role_title": "Analista de BI",
        "seniority_text": "Senior",
        "state_text": "SP",
        "regime_text": "CLT",
        "salary_text": "R$ 10.000 - R$ 15.000 por mes",
        "observed_at": "2026-09-01",
    }
    base.update(overrides)
    return base


def test_observacao_completa_tem_confianca_maxima():
    observation = NORMALIZER.normalize(_raw())
    assert observation.role_title == "Analista de BI"
    assert observation.seniority == "senior"
    assert observation.state == "SP"
    assert observation.regime == EmploymentRegime.CLT
    assert observation.salary_min == 10000.0
    assert observation.salary_max == 15000.0
    assert observation.currency == Currency.BRL
    assert observation.periodicity == Periodicity.MONTHLY
    assert observation.observed_at == date(2026, 9, 1)
    assert observation.confidence == 1.0


def test_campos_desconhecidos_reduzem_confianca_sem_inventar_dado():
    observation = NORMALIZER.normalize(
        _raw(seniority_text=None, state_text=None, regime_text=None, salary_text="a combinar")
    )
    assert observation.seniority == "unknown"
    assert observation.state is None
    assert observation.regime == EmploymentRegime.UNKNOWN
    assert observation.salary_min is None
    assert observation.confidence < 0.5


def test_aceita_data_ja_como_objeto_date():
    observation = NORMALIZER.normalize(_raw(observed_at=date(2026, 1, 15)))
    assert observation.observed_at == date(2026, 1, 15)
