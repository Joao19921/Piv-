"""Ponto de entrada do worker.

Nesta fase (2) nao existe nenhum pipeline concreto ligado -- adapters fake
chegam na Fase 4 e adapters reais, um por vez, na Fase 6. Este entrypoint so
resolve a configuracao e documenta o modo de execucao resolvido; ele nao
executa nenhuma coleta ainda.

Modos de execucao (ver docs/FASE-2-ARQUITETURA-BENCHMARK-WORKER.md):
  manual    -- disparo local por um humano (linha de comando).
  scheduled -- disparo por agendador externo (Fase 7 define o ambiente).
Em ambos os casos, quem decide o que coletar e o worker; o frontend do Pivo
nunca inicia uma coleta diretamente.
"""

from __future__ import annotations

import logging

from benchmark_worker.config import WorkerConfig
from benchmark_worker.logging_utils import configure_logging

logger = logging.getLogger(__name__)


def main() -> None:
    config = WorkerConfig.from_env()
    configure_logging(config.log_level)
    logger.info(
        "benchmark-worker inicializado (env=%s, run_mode=%s) -- nenhum pipeline "
        "concreto ligado nesta fase",
        config.env,
        config.run_mode.value,
    )


if __name__ == "__main__":
    main()
