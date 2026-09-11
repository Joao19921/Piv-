"""Extractor generico para fontes cujo payload bruto ja e uma lista de observacoes
(ex.: resposta JSON de uma API oficial que ja devolve registros agregados).

Uma fonte cujo payload exija parsing de HTML ou selecao de campos especificos deve
ter seu proprio Extractor (Fase 6) -- nunca reaproveitar este as cegas so porque
"tambem retorna uma lista".
"""

from __future__ import annotations

from benchmark_worker.domain.contracts import Extractor, RawObservation, RawPayload


class JsonListExtractor(Extractor):
    def extract(self, raw: RawPayload) -> list[RawObservation]:
        if not isinstance(raw, list):
            raise TypeError("JsonListExtractor espera uma lista de dicts como payload bruto")
        return raw
