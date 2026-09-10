"""Contrato normalizado de dados do benchmark worker.

Os campos aqui refletem o contrato definido na Fase 2 do plano
(docs/PLANO-BENCHMARK-WORKER.md): fonte, referencia, cargo, senioridade, UF,
regime, faixa salarial, moeda, periodicidade, data e confianca. Nenhum dado
pessoal (nome, e-mail, curriculo, cookie, token) pertence a este modelo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum


class SourceName(str, Enum):
    INDEED = "indeed"
    GLASSDOOR = "glassdoor"
    INFOJOBS = "infojobs"


class AdapterStatus(str, Enum):
    ENABLED = "enabled"
    DISABLED = "disabled"


class EmploymentRegime(str, Enum):
    CLT = "clt"
    PJ = "pj"
    UNKNOWN = "unknown"


class Currency(str, Enum):
    BRL = "brl"
    USD = "usd"
    UNKNOWN = "unknown"


class Periodicity(str, Enum):
    MONTHLY = "monthly"
    ANNUAL = "annual"
    UNKNOWN = "unknown"


class RunStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


@dataclass(frozen=True)
class SalaryObservation:
    """Uma referencia salarial agregada, ja normalizada e validada.

    ``source_reference`` guarda somente a referencia auditavel permitida pela
    fonte (ex: id publico, URL de listagem agregada), nunca a copia de uma
    pagina autenticada nem dado de uma pessoa especifica.
    """

    source: SourceName
    source_reference: str
    role_title: str
    seniority: str
    state: str  # UF
    regime: EmploymentRegime
    salary_min: float | None
    salary_max: float | None
    currency: Currency
    periodicity: Periodicity
    observed_at: date
    confidence: float  # 0.0 a 1.0
    collected_at: datetime


@dataclass(frozen=True)
class SourceRunResult:
    """Resultado do processamento de uma fonte dentro de uma execucao."""

    source: SourceName
    status: RunStatus
    observations: tuple[SalaryObservation, ...]
    error_summary: str | None = None


@dataclass(frozen=True)
class RunSummary:
    """Resumo agregado de uma execucao do worker, cobrindo todas as fontes."""

    started_at: datetime
    finished_at: datetime
    results: tuple[SourceRunResult, ...]

    @property
    def status(self) -> RunStatus:
        statuses = {result.status for result in self.results}
        if statuses == {RunStatus.SUCCESS}:
            return RunStatus.SUCCESS
        if RunStatus.SUCCESS in statuses or RunStatus.PARTIAL in statuses:
            return RunStatus.PARTIAL
        return RunStatus.FAILED
