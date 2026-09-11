# Benchmark Worker

Worker independente para coleta, normalizacao e persistencia de referencias
salariais de mercado. Roda fora da aplicacao Pivo (Express/React) e alimenta
o Supabase; o Pivo continua responsavel pela experiencia do usuario e pelo
consumo dos dados.

Regras de negócio, estado de conformidade das fontes e onde ficam
credenciais/segredos: [Manual do Benchmark Worker](../docs/BENCHMARK-WORKER-MANUAL.md).

Este projeto segue o plano incremental em
[docs/PLANO-BENCHMARK-WORKER.md](../docs/PLANO-BENCHMARK-WORKER.md). Estado atual:
Fases 0 a 5 e 7 concluidas -- nucleo executavel, persistencia em Postgres,
normalizacao/validacao testadas e agendamento via GitHub Actions
(`.github/workflows/benchmark-worker.yml`, a cada ~10 dias ou manual). Fase 6
(adapters reais por fonte) e Fase 8 (tela no admin) permanecem pendentes.

**Nenhum adapter real de Indeed, Glassdoor ou InfoJobs esta implementado.** Toda
execucao hoje reporta `SUCCESS` sem nenhuma observacao coletada, de proposito. Ver
[docs/FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md](../docs/FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md)
para o motivo: nenhuma das tres fontes tem autorizacao documentada para crawler
autenticado ou scraping automatico. `benchmark_sources` (Postgres) e a fonte unica
de verdade sobre esse estado -- mudar de DISABLED para ENABLED ali exige um adapter
real implementado antes (`build_adapters` recusa e levanta erro caso contrario).

## Estrutura

```
src/benchmark_worker/
  domain/
    models.py     contrato normalizado (SalaryObservation) e enums
    contracts.py  interfaces Adapter, Extractor, Normalizer, Validator, Repository
    errors.py     excecoes de dominio
  adapters/
    base.py       DisabledAdapter -- todo adapter sem autorizacao usa esta base
  extractors/
    generic.py    JsonListExtractor -- generico, para fontes cujo payload ja e uma lista
  normalization/
    salary_text.py  parsing de valor/moeda/periodicidade a partir de texto livre
    seniority.py    vocabulario controlado de senioridade
    employment.py   deteccao de regime (CLT/PJ)
    states.py       as 27 UFs suportadas
    normalizer.py   Normalizer concreto, combina os modulos acima
    validator.py    Validator concreto
  infrastructure/
    catalog.py             le benchmark_profiles/benchmark_sources do Postgres
    postgres_repository.py Repository concreto (grava benchmark_runs/benchmark_results)
  config.py         configuracao por variavel de ambiente
  logging_utils.py   logging sem segredos/dados pessoais
  retry.py           retry com backoff e isolamento de falha por fonte
  runner.py          orquestrador do pipeline (run_once/run_batch)
  cli.py             ponto de entrada -- liga tudo acima
```

## Desenvolvimento local

```
cd benchmark-worker
python -m venv .venv
. .venv/Scripts/activate  # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -e ".[dev]"
cp .env.example .env
python -m pytest            # testes unitarios, sem banco
python -m benchmark_worker.cli   # exige BENCHMARK_WORKER_DATABASE_URL no .env
```

## Arquivos protegidos

Este diretorio nao modifica `client/`, `server/` nem migrations existentes
do Pivo. Ver a secao "Arquivos protegidos durante a evolucao" em
[docs/PLANO-BENCHMARK-WORKER.md](../docs/PLANO-BENCHMARK-WORKER.md).
