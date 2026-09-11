"""Interfaces do pipeline do worker (Fase 2 do plano).

Pipeline: ``Adapter.fetch`` -> ``Extractor.extract`` -> ``Normalizer.normalize``
-> ``Validator.validate`` -> ``Repository.save_observations``.

Estas sao interfaces (contratos), sem implementacao real de acesso a
plataformas. Ver docs/FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md: nenhum adapter
concreto pode acessar Indeed, Glassdoor ou InfoJobs de verdade nesta fase.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Iterable

from benchmark_worker.domain.models import (
    AdapterStatus,
    RunSummary,
    SalaryObservation,
    SourceName,
)

# Payload cru retornado por um adapter; o formato e especifico de cada fonte
# e so tem significado para o Extractor correspondente.
RawPayload = Any

# Um registro ja extraido do payload cru, antes da normalizacao para o
# contrato comum (SalaryObservation).
RawObservation = dict[str, Any]


@dataclass(frozen=True)
class CollectionRequest:
    """Parametros de uma coleta: o que buscar, nao como buscar."""

    role_title: str
    seniority: str | None = None
    state: str | None = None


class Adapter(ABC):
    """Acesso a uma fonte externa. Um adapter DISABLED nunca deve ser chamado."""

    source: SourceName

    @property
    @abstractmethod
    def status(self) -> AdapterStatus:
        """Deve retornar DISABLED quando nao houver mecanismo autorizado
        configurado (ver Fase 1). O pipeline consulta isto antes de chamar
        ``fetch`` e nunca faz fallback para scraping quando a fonte falha."""

    @abstractmethod
    def fetch(self, request: CollectionRequest) -> RawPayload:
        """Busca dados brutos via mecanismo autorizado.

        Deve levantar ``AdapterDisabledError`` se ``status`` nao for
        ``ENABLED`` e ``SourceUnavailableError`` em falhas de rede/API.
        """


class Extractor(ABC):
    """Extrai registros brutos de um payload especifico de uma fonte."""

    @abstractmethod
    def extract(self, raw: RawPayload) -> list[RawObservation]: ...


class Normalizer(ABC):
    """Converte um registro extraido para o contrato normalizado comum."""

    @abstractmethod
    def normalize(self, raw_observation: RawObservation) -> SalaryObservation: ...


class Validator(ABC):
    """Valida uma observacao normalizada antes da persistencia."""

    @abstractmethod
    def validate(self, observation: SalaryObservation) -> None:
        """Levanta ``ValidationError`` quando a observacao e invalida."""


class Repository(ABC):
    """Persistencia das observacoes e do historico de execucoes."""

    @abstractmethod
    def save_observations(self, observations: Iterable[SalaryObservation]) -> None: ...

    @abstractmethod
    def save_run_summary(self, summary: RunSummary) -> None: ...
