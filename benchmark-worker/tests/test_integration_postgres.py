"""Testes de integracao contra um Postgres de verdade.

So rodam quando `BENCHMARK_WORKER_DATABASE_URL` esta configurada (o job de CI sobe um
Postgres efemero e aplica as migrations do Pivo antes de chamar pytest -- ver
.github/workflows/benchmark-worker.yml). Localmente, sem essa variavel, estes testes
sao pulados e o restante da suite roda normalmente.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone

import psycopg
import pytest

from benchmark_worker.domain.models import (
    Currency,
    EmploymentRegime,
    Periodicity,
    RunStatus,
    RunSummary,
    SalaryObservation,
    SourceName,
    SourceRunResult,
)
from benchmark_worker.infrastructure.catalog import load_source_rows
from benchmark_worker.infrastructure.postgres_repository import PostgresRepository

pytestmark = pytest.mark.skipif(
    not os.environ.get("BENCHMARK_WORKER_DATABASE_URL"),
    reason="BENCHMARK_WORKER_DATABASE_URL nao configurado -- teste de integracao pulado",
)


def _dsn() -> str:
    return os.environ["BENCHMARK_WORKER_DATABASE_URL"]


def test_seed_de_fontes_vem_desabilitado():
    rows = load_source_rows(_dsn())
    names = {row.name.value for row in rows}
    assert names == {"indeed", "glassdoor", "infojobs"}
    assert all(row.status.value == "disabled" for row in rows)
    assert all(row.disabled_reason for row in rows)


def test_persistencia_e_idempotente():
    observation = SalaryObservation(
        source=SourceName.INDEED,
        source_reference="integration-test-ref",
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
    summary = RunSummary(
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
        triggered_by="manual",
        results=(SourceRunResult(source=SourceName.INDEED, status=RunStatus.SUCCESS, observations=(observation,)),),
    )

    repository = PostgresRepository(_dsn())
    repository.save_run_summary(summary)
    repository.save_run_summary(summary)  # mesma (source, source_reference, observed_at): nao deve duplicar

    with psycopg.connect(_dsn()) as conn, conn.cursor() as cur:
        cur.execute(
            "select count(*) from benchmark_results where source_reference = %s",
            ("integration-test-ref",),
        )
        assert cur.fetchone()[0] == 1

        cur.execute("select count(*) from benchmark_runs")
        assert cur.fetchone()[0] == 2  # cada chamada grava sua propria linha de execucao
