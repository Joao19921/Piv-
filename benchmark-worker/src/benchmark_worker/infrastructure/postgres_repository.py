"""Repository Postgres do worker.

Persiste no schema aditivo da Fase 3 (`server/db/migrations/0011_benchmark_worker_schema.sql`).
Usa uma connection string propria do worker (`BENCHMARK_WORKER_DATABASE_URL`), separada
da que o backend Express usa -- ver a nota de RLS na migration: o worker deve ter
acesso apenas ao necessario, nunca a mesma credencial administrativa da aplicacao.
"""

from __future__ import annotations

import json

import psycopg

from benchmark_worker.domain.contracts import Repository
from benchmark_worker.domain.models import RunSummary


class PostgresRepository(Repository):
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def save_run_summary(self, summary: RunSummary) -> None:
        source_summary = [
            {
                "source": result.source.value,
                "status": result.status.value,
                "observations": len(result.observations),
                "error_summary": result.error_summary,
            }
            for result in summary.results
        ]

        # Uma unica conexao/transacao para a linha de execucao e todas as observacoes
        # que ela produziu: se algo falhar no meio, nao sobra um `benchmark_runs` sem
        # os resultados correspondentes (nem o inverso).
        with psycopg.connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                insert into benchmark_runs (status, triggered_by, source_summary, started_at, finished_at)
                values (%s, %s, %s, %s, %s)
                returning id
                """,
                (
                    summary.status.value,
                    summary.triggered_by,
                    json.dumps(source_summary),
                    summary.started_at,
                    summary.finished_at,
                ),
            )
            run_id = cur.fetchone()[0]

            for result in summary.results:
                for observation in result.observations:
                    cur.execute(
                        """
                        insert into benchmark_results
                            (run_id, source, source_reference, role_title, seniority,
                             state, regime, salary_min, salary_max, currency,
                             periodicity, observed_at, confidence, collected_at)
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        on conflict (source, source_reference, observed_at) do update set
                            role_title = excluded.role_title,
                            seniority = excluded.seniority,
                            state = excluded.state,
                            regime = excluded.regime,
                            salary_min = excluded.salary_min,
                            salary_max = excluded.salary_max,
                            currency = excluded.currency,
                            periodicity = excluded.periodicity,
                            confidence = excluded.confidence,
                            collected_at = excluded.collected_at
                        """,
                        (
                            run_id,
                            observation.source.value,
                            observation.source_reference,
                            observation.role_title,
                            observation.seniority,
                            observation.state,
                            observation.regime.value,
                            observation.salary_min,
                            observation.salary_max,
                            observation.currency.value,
                            observation.periodicity.value,
                            observation.observed_at,
                            observation.confidence,
                            observation.collected_at,
                        ),
                    )
            conn.commit()
