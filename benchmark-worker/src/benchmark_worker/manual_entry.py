"""Registro manual de uma observacao vinda de uma fonte publica legitima.

Diferente do pipeline automatizado (runner.py): aqui nao ha Adapter nem fetch. Uma
pessoa le um numero num relatorio publico (ex.: guia salarial da Robert Half, que
publica faixas agregadas por cargo/senioridade/cidade sem paywall) e o registra
explicitamente -- passa pela mesma normalizacao/validacao/persistencia do resto do
worker, sem nenhuma automacao contra uma plataforma de terceiros.

O que pode ser citado aqui (ver docs/BENCHMARK-WORKER-MANUAL.md, secao "Fontes
legitimas"): relatorios publicos, sem paywall, cujos termos nao proibem citar
valores agregados. Nunca uma fonte cujos termos proibem reuso (ex.: Catho) nem
conteudo obtido atras de um formulario de lead-gen (ex.: Michael Page, Hays) --
preencher aquele formulario so para extrair o PDF e' o mesmo problema de
autorizacao do scraping, so que manual.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone

from benchmark_worker.domain.contracts import Repository
from benchmark_worker.domain.models import RunStatus, RunSummary, SourceName, SourceRunResult
from benchmark_worker.infrastructure.postgres_repository import PostgresRepository
from benchmark_worker.normalization.normalizer import SalaryObservationNormalizer
from benchmark_worker.normalization.validator import SalaryObservationValidator

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ManualEntryInput:
    role_title: str
    # URL ou identificacao precisa do relatorio/pagina consultada -- obrigatorio,
    # e' a referencia auditavel que sustenta o dado (SalaryObservation.source_reference).
    source_reference: str
    salary_text: str
    observed_at: date
    seniority_text: str | None = None
    state_text: str | None = None
    regime_text: str | None = None


def register_manual_entry(dsn: str, entry: ManualEntryInput, *, repository: Repository | None = None) -> RunSummary:
    """Normaliza, valida e persiste uma unica observacao manual.

    Levanta ``ValidationError`` (ver domain/errors.py) se o dado nao passar na
    validacao -- por exemplo, nenhum valor salarial reconhecido no texto informado.

    ``repository`` e' injetavel para teste (fake em memoria); em uso normal, None
    constroi um ``PostgresRepository(dsn)``.
    """

    raw_observation = {
        "source": SourceName.MANUAL,
        "source_reference": entry.source_reference,
        "role_title": entry.role_title,
        "seniority_text": entry.seniority_text,
        "state_text": entry.state_text,
        "regime_text": entry.regime_text,
        "salary_text": entry.salary_text,
        "observed_at": entry.observed_at,
    }

    observation = SalaryObservationNormalizer().normalize(raw_observation)
    SalaryObservationValidator().validate(observation)

    summary = RunSummary(
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
        triggered_by="manual",
        results=(
            SourceRunResult(
                source=SourceName.MANUAL,
                status=RunStatus.SUCCESS,
                observations=(observation,),
            ),
        ),
    )

    (repository or PostgresRepository(dsn)).save_run_summary(summary)
    logger.info(
        "observacao manual registrada: cargo=%r referencia=%r confidence=%.2f",
        entry.role_title,
        entry.source_reference,
        observation.confidence,
    )
    return summary
