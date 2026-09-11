"""Validacao de uma observacao ja normalizada, antes da persistencia."""

from __future__ import annotations

from benchmark_worker.domain.contracts import Validator
from benchmark_worker.domain.errors import ValidationError
from benchmark_worker.domain.models import SalaryObservation
from benchmark_worker.normalization.states import UFS


class SalaryObservationValidator(Validator):
    def validate(self, observation: SalaryObservation) -> None:
        if not observation.role_title.strip():
            raise ValidationError("role_title vazio")
        if not observation.source_reference.strip():
            raise ValidationError("source_reference vazio")
        if observation.state is not None and observation.state not in UFS:
            raise ValidationError(f"UF invalida: {observation.state!r}")
        if observation.salary_min is None and observation.salary_max is None:
            raise ValidationError("nenhum valor salarial reconhecido no texto da fonte")
        if (
            observation.salary_min is not None
            and observation.salary_max is not None
            and observation.salary_min > observation.salary_max
        ):
            raise ValidationError("salary_min maior que salary_max")
        if observation.salary_min is not None and observation.salary_min <= 0:
            raise ValidationError("salary_min deve ser positivo")
        if not 0.0 <= observation.confidence <= 1.0:
            raise ValidationError("confidence fora do intervalo [0,1]")
