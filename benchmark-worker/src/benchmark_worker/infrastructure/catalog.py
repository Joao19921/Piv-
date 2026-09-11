"""Carrega o catalogo de perfis ativos e o estado das fontes a partir do Postgres.

Le somente das tabelas aditivas da Fase 3
(server/db/migrations/0011_benchmark_worker_schema.sql): `benchmark_profiles` e
`benchmark_sources`. Nenhuma tabela da aplicacao principal e tocada.
"""

from __future__ import annotations

from dataclasses import dataclass

import psycopg

from benchmark_worker.adapters.base import DisabledAdapter
from benchmark_worker.domain.contracts import Adapter, CollectionRequest
from benchmark_worker.domain.models import AdapterStatus, SourceName


@dataclass(frozen=True)
class SourceRow:
    name: SourceName
    status: AdapterStatus
    disabled_reason: str | None


def load_active_profiles(dsn: str) -> list[CollectionRequest]:
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("select role_title, seniority, state from benchmark_profiles where active")
        rows = cur.fetchall()
    return [
        CollectionRequest(role_title=role_title, seniority=seniority, state=state)
        for role_title, seniority, state in rows
    ]


def load_source_rows(dsn: str) -> list[SourceRow]:
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("select name, status, disabled_reason from benchmark_sources")
        rows = cur.fetchall()
    return [
        SourceRow(name=SourceName(name), status=AdapterStatus(status), disabled_reason=reason)
        for name, status, reason in rows
    ]


def build_adapters(source_rows: list[SourceRow]) -> list[Adapter]:
    """Constroi um adapter por fonte automatizavel.

    Hoje toda fonte automatizavel (indeed/glassdoor/infojobs) esta DISABLED (Fase 1),
    entao todas viram `DisabledAdapter` com o motivo vindo do banco -- unica fonte de
    verdade sobre por que cada uma esta desligada. Quando uma fonte for autorizada
    (Fase 6), este e' o unico lugar que precisa trocar o adapter concreto; o restante
    do pipeline nao muda.

    `SourceName.MANUAL` nunca passa por aqui: nao ha fetch nem adapter para entrada
    manual, ela grava direto via `benchmark_worker.manual_entry` (ver esse modulo).
    """

    adapters: list[Adapter] = []
    for row in source_rows:
        if row.name is SourceName.MANUAL:
            continue
        if row.status is AdapterStatus.DISABLED:
            adapters.append(DisabledAdapter(row.name, row.disabled_reason or "sem motivo registrado"))
        else:
            raise NotImplementedError(
                f"fonte {row.name.value} marcada como ENABLED no banco, mas nenhum adapter "
                "real esta implementado ainda (Fase 6 -- ver FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md)"
            )
    return adapters
