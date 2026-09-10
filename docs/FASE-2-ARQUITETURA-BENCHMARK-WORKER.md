# Fase 2 - Contrato e arquitetura do worker

**Status:** concluida
**Escopo:** estrutura inicial do projeto `benchmark-worker/` e contratos internos, sem acesso real a Indeed, Glassdoor ou InfoJobs.

Esta fase nao cria migrations, nao acessa nenhuma plataforma e nao adiciona
credenciais. O gate definido na Fase 1 continua valendo: adapters reais
ficam bloqueados ate autorizacao documentada por fonte.

## Runtime

Python 3.11+, conforme preferencia registrada na Fase 0/1. Projeto
empacotado com `pyproject.toml` (`setuptools`), sem dependencias externas
obrigatorias nesta fase -- `pytest` e opcional, apenas para desenvolvimento.

## Estrutura criada

```
benchmark-worker/
  pyproject.toml
  .env.example
  README.md
  src/benchmark_worker/
    domain/
      models.py     contrato normalizado e enums
      contracts.py  interfaces Adapter, Extractor, Normalizer, Validator, Repository
      errors.py     AdapterDisabledError, SourceUnavailableError, ValidationError
    adapters/
      base.py       DisabledAdapter
    config.py
    logging_utils.py
    retry.py
    runner.py
    cli.py
```

## Contrato normalizado

`SalaryObservation` (`domain/models.py`) tem os campos definidos no plano:
fonte (`source`), referencia auditavel (`source_reference`), cargo
(`role_title`), senioridade (`seniority`), UF (`state`), regime
(`EmploymentRegime`: CLT/PJ/UNKNOWN), faixa salarial (`salary_min`/
`salary_max`), moeda (`Currency`), periodicidade (`Periodicity`), data da
observacao (`observed_at`) e confianca (`confidence`, 0.0-1.0). Nao ha campo
para dado pessoal -- isso e proibido pela Fase 1, nao apenas omitido.

`source_reference` deve guardar somente a referencia que a fonte permite
expor (id publico, URL de listagem agregada), nunca a copia de uma pagina
autenticada.

## Interfaces

`domain/contracts.py` define o pipeline como uma cadeia de interfaces
(`abc.ABC`), cada uma com uma responsabilidade unica:

1. `Adapter.fetch` -- busca dados brutos via mecanismo autorizado. Expoe
   `status: AdapterStatus` (`ENABLED`/`DISABLED`); o runner consulta isso
   antes de chamar `fetch` e nunca faz fallback para scraping quando uma
   fonte esta desabilitada ou falha.
2. `Extractor.extract` -- extrai registros brutos (`RawObservation`) de um
   payload especifico da fonte.
3. `Normalizer.normalize` -- converte um registro bruto para
   `SalaryObservation`.
4. `Validator.validate` -- valida a observacao normalizada, levantando
   `ValidationError` quando invalida.
5. `Repository.save_observations` / `save_run_summary` -- persistencia
   (implementacao real de Supabase entra na Fase 3+, depois das migrations
   novas).

`adapters/base.py` define `DisabledAdapter`, a base que qualquer adapter sem
autorizacao documentada deve usar: `status` sempre `DISABLED` e `fetch`
sempre levanta `AdapterDisabledError`. Isso torna o estado desabilitado
explicito por construcao, nao por convencao -- atende a regra 1 da secao
"Regras tecnicas resultantes" da Fase 1.

## Timeouts, retry e isolamento de falha

`config.py` le `BENCHMARK_WORKER_SOURCE_TIMEOUT_SECONDS`,
`BENCHMARK_WORKER_SOURCE_MAX_RETRIES` e
`BENCHMARK_WORKER_SOURCE_RETRY_BACKOFF_SECONDS` do ambiente (defaults: 30s,
2 tentativas, 5s de backoff).

`retry.py` tem duas responsabilidades separadas:

- `retry_with_backoff`: reexecuta uma chamada em `SourceUnavailableError`
  ate o limite configurado, com backoff fixo. `AdapterDisabledError` nunca e
  retryable.
- `run_isolated`: garante que uma excecao de uma fonte nunca propaga para as
  demais. `runner.WorkerRunner` usa isso por fonte, entao a falha de uma
  fonte vira `RunStatus.FAILED` so para ela, e `RunSummary.status` agrega o
  resultado (`SUCCESS` se todas ok, `PARTIAL` se houver mistura, `FAILED` se
  todas falharem) -- a regra da Fase 5 ("erro em uma fonte resulta em
  PARTIAL, sem impedir as demais") fica garantida na composicao, nao em cada
  adapter individualmente.

## Logs seguros

`logging_utils.py` centraliza a configuracao de log e oferece `redact` para
mascarar chaves sensiveis (senha, token, cookie, sessao, api key,
credential) quando um dicionario de contexto precisa ser logado. Isso e uma
segunda camada de protecao: a responsabilidade primaria continua sendo nunca
logar esses valores.

## Estrategia de execucao

- **Manual**: `python -m benchmark_worker.cli` localmente, com
  `BENCHMARK_WORKER_RUN_MODE=manual`. Uso: desenvolvimento e testes ad-hoc.
- **Agendada**: mesmo pipeline, disparado por um agendador externo (a
  escolha de ambiente -- Lambda, Render, GitHub Actions ou outro -- e
  decisao da Fase 7, que tambem compara custo, memoria, tempo de execucao e
  limites de automacao de navegador). O worker em si nao sabe quem o
  disparou, apenas le `BENCHMARK_WORKER_RUN_MODE` para log/observabilidade.
- Em nenhum dos dois modos o frontend do Pivo inicia uma coleta diretamente
  (regra ja registrada no plano).

`cli.py` hoje apenas resolve configuracao e loga o modo -- nenhum pipeline
concreto esta ligado, porque adapters fake/fixture (Fase 4) e adapters reais
(Fase 6) ainda nao existem.

## O que esta fora do escopo desta fase

- Migrations novas (`benchmark_sources`, `benchmark_profiles`,
  `benchmark_jobs`, `benchmark_results`, `benchmark_runs`) -- Fase 3.
- Qualquer implementacao de `Repository` contra Supabase -- depende da
  Fase 3.
- Adapters fake/fixture executando o pipeline de ponta a ponta -- Fase 4.
- Qualquer adapter real de Indeed, Glassdoor ou InfoJobs -- Fase 6, bloqueada
  por fonte ate autorizacao documentada.

## Proximo passo

Fase 3: migrations aditivas e isoladas para as tabelas do worker, validando
que a aplicacao atual continua lendo suas tabelas existentes sem mudanca.
