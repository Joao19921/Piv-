# Benchmark Worker

Worker independente para coleta, normalizacao e persistencia de referencias
salariais de mercado. Roda fora da aplicacao Pivo (Express/React) e alimenta
o Supabase; o Pivo continua responsavel pela experiencia do usuario e pelo
consumo dos dados.

Este projeto segue o plano incremental em
[docs/PLANO-BENCHMARK-WORKER.md](../docs/PLANO-BENCHMARK-WORKER.md). Estado
atual: Fase 2 (contrato e arquitetura), documentada em
[docs/FASE-2-ARQUITETURA-BENCHMARK-WORKER.md](../docs/FASE-2-ARQUITETURA-BENCHMARK-WORKER.md).

**Nenhum adapter real de Indeed, Glassdoor ou InfoJobs esta implementado.**
Ver [docs/FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md](../docs/FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md)
para o motivo: nenhuma das tres fontes tem autorizacao documentada para
crawler autenticado ou scraping automatico.

## Estrutura

```
src/benchmark_worker/
  domain/
    models.py     contrato normalizado (SalaryObservation) e enums
    contracts.py  interfaces Adapter, Extractor, Normalizer, Validator, Repository
    errors.py     excecoes de dominio
  adapters/
    base.py       DisabledAdapter -- todo adapter sem autorizacao usa esta base
  config.py        configuracao por variavel de ambiente
  logging_utils.py logging sem segredos/dados pessoais
  retry.py          retry com backoff e isolamento de falha por fonte
  runner.py         orquestrador do pipeline
  cli.py             ponto de entrada
```

## Desenvolvimento local

```
cd benchmark-worker
python -m venv .venv
. .venv/Scripts/activate  # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -e ".[dev]"
cp .env.example .env
python -m benchmark_worker.cli
```

## Arquivos protegidos

Este diretorio nao modifica `client/`, `server/` nem migrations existentes
do Pivo. Ver a secao "Arquivos protegidos durante a evolucao" em
[docs/PLANO-BENCHMARK-WORKER.md](../docs/PLANO-BENCHMARK-WORKER.md).
