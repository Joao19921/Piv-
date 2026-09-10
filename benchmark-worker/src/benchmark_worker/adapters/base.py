"""Base para adapters sem mecanismo de acesso autorizado.

Todo adapter concreto de Indeed, Glassdoor e InfoJobs deve herdar de
``DisabledAdapter`` ate que exista autorizacao documentada para essa fonte
especifica (ver docs/FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md, secao
"Pendencias para liberar uma fonte"). Isso torna o estado DISABLED explicito
e impossivel de burlar por omissao.
"""

from __future__ import annotations

from benchmark_worker.domain.contracts import Adapter, CollectionRequest, RawPayload
from benchmark_worker.domain.errors import AdapterDisabledError
from benchmark_worker.domain.models import AdapterStatus, SourceName


class DisabledAdapter(Adapter):
    """Adapter cujo mecanismo autorizado ainda nao foi configurado."""

    def __init__(self, source: SourceName, reason: str) -> None:
        self.source = source
        self._reason = reason

    @property
    def status(self) -> AdapterStatus:
        return AdapterStatus.DISABLED

    def fetch(self, request: CollectionRequest) -> RawPayload:
        raise AdapterDisabledError(
            f"adapter de {self.source.value} desabilitado: {self._reason}"
        )
