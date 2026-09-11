"""Normalizador generico do contrato comum.

Fica de fora de qualquer fonte especifica -- um Extractor (fonte a fonte, Fase 6)
e' quem transforma o payload bruto de uma plataforma neste formato de dict
intermediario:

    source            SourceName
    source_reference  str (referencia auditavel permitida pela fonte)
    role_title        str
    seniority_text    str | None (texto livre da fonte, ex.: "Senior")
    state_text        str | None (texto livre, ex.: "SP" ou "Sao Paulo, SP")
    regime_text       str | None (texto livre, ex.: "CLT", "PJ", "Contractor")
    salary_text       str (ex.: "R$ 10.000 - R$ 15.000 por mes")
    observed_at       date | str ISO-8601

Este normalizador nao conhece nenhuma fonte especifica -- so sabe interpretar esse
formato intermediario e calcular uma confianca a partir do que nao pode reconhecer
com seguranca.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from benchmark_worker.domain.contracts import Normalizer, RawObservation
from benchmark_worker.domain.models import Currency, EmploymentRegime, Periodicity, SalaryObservation
from benchmark_worker.normalization.employment import normalize_regime
from benchmark_worker.normalization.salary_text import parse_salary_text
from benchmark_worker.normalization.seniority import normalize_seniority
from benchmark_worker.normalization.states import normalize_state


class SalaryObservationNormalizer(Normalizer):
    def normalize(self, raw_observation: RawObservation) -> SalaryObservation:
        seniority, seniority_known = normalize_seniority(raw_observation.get("seniority_text"))
        state = normalize_state(raw_observation.get("state_text"))
        regime = normalize_regime(raw_observation.get("regime_text"))
        parsed_salary = parse_salary_text(raw_observation.get("salary_text", ""))

        observed_at = raw_observation["observed_at"]
        if isinstance(observed_at, str):
            observed_at = date.fromisoformat(observed_at)

        confidence = 1.0
        if not seniority_known:
            confidence -= 0.25
        if state is None:
            confidence -= 0.25
        if regime == "unknown":
            confidence -= 0.15
        if parsed_salary.currency == "unknown":
            confidence -= 0.15
        if parsed_salary.periodicity == "unknown":
            confidence -= 0.1
        if parsed_salary.salary_min is None:
            confidence -= 0.3
        confidence = max(0.0, min(1.0, confidence))

        return SalaryObservation(
            source=raw_observation["source"],
            source_reference=raw_observation["source_reference"],
            role_title=raw_observation["role_title"],
            seniority=seniority,
            state=state,
            regime=EmploymentRegime(regime),
            salary_min=parsed_salary.salary_min,
            salary_max=parsed_salary.salary_max,
            currency=Currency(parsed_salary.currency),
            periodicity=Periodicity(parsed_salary.periodicity),
            observed_at=observed_at,
            confidence=confidence,
            collected_at=datetime.now(timezone.utc),
        )
