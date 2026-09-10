"""Erros de dominio do benchmark worker.

Nenhuma excecao deste modulo deve carregar segredo, credencial, cookie ou
corpo de resposta bruto de uma pagina autenticada -- apenas mensagens seguras
para log (ver ``benchmark_worker.logging_utils``).
"""

from __future__ import annotations


class BenchmarkWorkerError(Exception):
    """Erro base do worker."""


class AdapterDisabledError(BenchmarkWorkerError):
    """Levantado ao tentar executar um adapter sem mecanismo autorizado.

    Ver docs/FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md para o motivo de cada
    fonte estar desabilitada nesta fase.
    """


class SourceUnavailableError(BenchmarkWorkerError):
    """Falha ao consultar uma fonte (timeout, erro de rede, erro da API)."""


class ValidationError(BenchmarkWorkerError):
    """Um dado extraido nao passou na validacao do contrato normalizado."""
