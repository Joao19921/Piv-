# Arquitetura - Pivo

Este documento descreve a arquitetura atualmente implementada. Ele nao substitui o PRD original; o PRD historico fica em [PRD-original.md](PRD-original.md).

## Decisao De Stack

O PRD original previa Python/FastAPI e um MCP server separado. A base real do produto ja estava em React/Vite com um backend Express minimo. A evolucao foi feita mantendo Node/TypeScript para reduzir custo operacional e evitar dois runtimes no primeiro ambiente de teste.

A separacao de responsabilidades do PRD foi mantida por camadas:

```text
Browser
  |
  | REST JSON /api/v1/*
  v
Express server
  |
  |-- presentation/    rotas HTTP, validacao simples, contratos REST
  |-- domain/          calculos, catalogos e regras de negocio
  `-- infrastructure/  coletores externos, cache e resiliencia
```

## Runtime

Em desenvolvimento existem dois processos:

- Vite em `localhost:3000`;
- Express em `localhost:3001`.

Em producao existe um unico processo Express:

- serve a API em `/api/v1/*`;
- serve os arquivos estaticos do frontend gerados em `dist/public`;
- aplica Basic Auth quando `NODE_ENV=production` e `TEST_ACCESS_USER`/`TEST_ACCESS_PASSWORD` estao definidos;
- mantem `/api/v1/healthz` fora do Basic Auth para health check de orquestrador.

## Modulos De Codigo

### Frontend

```text
client/src/pages/Home.tsx
client/src/hooks/*
client/src/lib/api.ts
client/src/components/ui/*
```

Responsabilidades:

- renderizar os modulos de negocio;
- consultar a API com TanStack Query;
- expor estados de carregamento, erro, fallback e fonte;
- manter estado de UI local.

### Presentation

```text
server/src/presentation/app.ts
```

Responsabilidades:

- registrar rotas REST;
- converter query/body em entrada de dominio;
- devolver respostas padronizadas;
- nao conter regra de precificacao.

### Domain

```text
server/src/domain/services/
```

Responsabilidades:

- calcular taxa-hora de mao de obra;
- aplicar Fator K, margem e horas faturaveis;
- manter catalogos de perfis, licencas, regioes e SKUs;
- calcular custo mensal de cloud;
- estimar benchmark salarial por cargo, UF e cidade.

Arquivos principais:

- `laborPricing.ts`: custo mensal, custo/hora e taxa sugerida.
- `marketBenchmark.ts`: benchmark por cargo/regiao com historico.
- `cloudPricing.ts`: composicao de custo cloud em BRL/USD.
- `cloudCatalog.ts`: providers, regioes e SKUs.
- `catalogs.ts`: perfis profissionais e licencas SaaS.

### Infrastructure

```text
server/src/infrastructure/
```

Responsabilidades:

- chamar APIs externas;
- aplicar circuit breaker, retry, cache e fallback;
- persistir cache local em arquivo.

Arquivos principais:

- `collectors/bacenCollector.ts`: PTAX via BACEN Olinda API.
- `collectors/azureCollector.ts`: Azure Retail Prices API (consulta ao vivo, por requisicao).
- `collectors/awsCollector.ts`: AWS Pricing API (`GetProducts`, SDK `@aws-sdk/client-pricing`); usa a cadeia padrao de credenciais do SDK — na Lambda, a IAM Role de execucao (sem access key fixa); localmente, uma sessao `aws configure`/`aws sso login` se existir.
- `collectors/gcpCollector.ts`: GCP Cloud Billing Catalog API; exige `GOOGLE_CLOUD_BILLING_API_KEY`. Precifica instancias predefinidas como vCPU-preco + RAM-preco (GCP nao tem SKU unico "por instancia").
- `collectors/staticFallbacks.ts`: valores estaticos para operacao degradada (ultimo nivel de fallback).
- `resilience/resilienceManager.ts`: politica de resiliencia (circuit breaker, retry, cache, fallback).
- `cache/fileCache.ts`: cache JSON em `data/cache` (fallback de nivel 3 quando o Postgres nao esta configurado).
- `db/client.ts`: pool `pg` para o Postgres (Supabase), com observabilidade de consultas (duracao, erros) via `observability/queryStats.ts`.
- `repositories/`: `cloudPricingRepository`, `fxRepository`, `marketBenchmarkRepository`, `ingestionRunsRepository` — leitura/escrita das tabelas descritas em "Banco De Dados" abaixo.
- `observability/logger.ts` e `observability/queryStats.ts`: logging estruturado (JSON por linha, capturado pelo log viewer do Render) e contadores em memoria por consulta.

## Padrao De Resiliencia

Chamadas dependentes de fonte externa seguem quatro camadas:

1. Circuit breaker em memoria por servico.
2. Retry com backoff exponencial.
3. Cache local em disco.
4. Fallback estatico.

O contrato retornado e:

```ts
{
  status: "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE",
  source: string,
  timestamp: string,
  warning?: string,
  data: T
}
```

O frontend usa esse contrato diretamente para mostrar se um numero veio de fonte ao vivo, cache ou snapshot.

## Fontes De Dados

| Fonte | Implementacao atual | Estado |
| :--- | :--- | :--- |
| BACEN PTAX | API Olinda publica | Ao vivo (por requisicao) |
| Azure Retail Prices | API publica da Microsoft | Ao vivo (por requisicao) |
| AWS EC2 | AWS Pricing API (`GetProducts`) via ingestao periodica (cron 5 dias) + leitura do Postgres | Ao vivo na ingestao; leitura em runtime vem do Postgres |
| GCP Compute Engine | Cloud Billing Catalog API via ingestao periodica (cron 5 dias) + leitura do Postgres | Ao vivo na ingestao; leitura em runtime vem do Postgres |
| Perfis CAGED/MTE | Catalogo parametrizado local | Snapshot |
| Benchmark salarial | Modelo local (catalogo interno CLT/PJ) + opcional `MARKET_BENCHMARK_CONNECTOR_URL`; historico persistido no Postgres | Snapshot ou conector |
| Licencas SaaS | Catalogo local com URLs oficiais | Snapshot |
| PNCP | API de consulta publica (`/v1/contratacoes/publicacao`), sem chave | Ao vivo (checagem de saude por requisicao em `/system-health`) |

Sem `DATABASE_URL` configurado, ou se o Postgres estiver fora do ar, AWS/GCP/benchmark caem para o snapshot estatico embutido no codigo (mesmo comportamento da fase anterior) — o app nunca fica sem responder por falta de banco.

## Banco De Dados

Projeto Supabase dedicado (Postgres 17, plano free, regiao `sa-east-1`). Acesso via `pg`, sem ORM. RLS habilitado em todas as tabelas sem policies, bloqueando qualquer acesso via PostgREST/anon key — o backend conecta como usuario com privilegios diretos no Postgres, que ignora RLS.

**`DATABASE_URL` deve apontar para o Connection Pooler (Supavisor), nao para o "Direct connection".** O host direto (`db.<projeto>.supabase.co`) so resolve em IPv6; Lambda (fora de VPC) e a maioria dos PaaS (Render incluso) so tem saida IPv4, entao a conexao falha com `getaddrinfo ENOTFOUND` — descoberto ao testar a Lambda pela primeira vez. O host do pooler e o mesmo (`aws-0-<regiao>.pooler.supabase.com`, usuario `postgres.<projeto>`) nos dois lugares, mas a porta muda conforme o padrao de conexao (recomendacao da propria Supabase):

- **Render** (processo unico, `pg.Pool` de vida longa): porta **5432**, modo "Session".
- **Lambda** (uma invocacao por vez, conexao curta): porta **6543**, modo "Transaction".

Tabelas (`server/db/migrations/0001_core_schema.sql`):

- `cloud_skus` / `cloud_regions`: dimensao do catalogo de compute (metadados; sem preco embutido).
- `cloud_prices`: historico insert-only de preco por SKU/regiao (o preco "atual" e a linha mais recente).
- `fx_rates`: historico de cotacoes PTAX.
- `market_benchmark_searches` / `market_benchmark_sources`: historico de buscas de benchmark salarial (substitui o cache em arquivo `data/cache/market-benchmark-history`).
- `ingestion_runs`: uma linha por execucao de coletor/ingestao (servico, status, registros atualizados, duracao, erro) — base do painel de observabilidade em `/system-health` e na tela "Fontes".

## Ingestao Periodica (Lambda + EventBridge)

A logica de ingestao vive em `server/src/domain/services/ingestionOrchestrator.ts` (compartilhada entre dois pontos de entrada, para nao duplicar codigo):

- `server/lambda/refreshSourcesHandler.ts`: handler da Lambda `pivo-refresh-sources`, disparada por um EventBridge Scheduled Rule a cada ~5 dias (`cron(0 6 1,6,11,16,21,26 * ? *)`; cron e baseado em calendario, entao o intervalo real varia entre 4 e 6 dias na virada do mes). Autentica na AWS Pricing API via **IAM Role de execucao** — nao usa access key fixa. `DATABASE_URL` e `GOOGLE_CLOUD_BILLING_API_KEY` sao variaveis de ambiente da funcao.
- `server/scripts/refreshSources.ts`: mesma logica, para rodar manualmente em dev (`pnpm run refresh-sources`).

Empacotamento: `pnpm run build:lambda` gera um bundle CJS unico (`dist-lambda/index.cjs`, via esbuild) e `scripts/deploy-lambda.ps1` cria/atualiza a IAM Role (policy minima `pricing:GetProducts`/`pricing:DescribeServices`), a funcao Lambda e o EventBridge Scheduled Rule via AWS CLI. A Lambda nao fica em VPC (acesso direto a internet, sem custo de NAT Gateway) para alcancar o Postgres (Supabase) e as APIs HTTPS publicas.

Para cada SKU/regiao do catalogo, a ingestao consulta o coletor real (Azure/AWS/GCP) e grava o preco em `cloud_prices`; tambem atualiza `fx_rates`. Cada fonte grava um resumo em `ingestion_runs`.

Azure tambem continua com consulta ao vivo por requisicao a partir do proprio app web (nao depende da Lambda). AWS e GCP **nao** sao consultados ao vivo pelo app web — `/cloud/estimate` so le o ultimo preco gravado em `cloud_prices` (ou o snapshot estatico, se ainda nao houver ingestao para aquele SKU/regiao). Isso evita expor credencial AWS/GCP no servico web e evita o custo/latencia de uma chamada cara (o coletor GCP pagina milhares de SKUs) por requisicao. Toda chamada Azure ao vivo bem-sucedida tambem grava uma linha em `cloud_prices`, mantendo o Postgres fresco entre as janelas da Lambda.

## Observabilidade

- **Servicos externos**: `/system-health` combina checagem ao vivo (BACEN, Azure) com a ultima linha de `ingestion_runs` por servico (AWS, GCP) — status, quantidade de registros atualizados, duracao e erro da ultima execucao.
- **Consultas ao Postgres**: `server/src/infrastructure/db/client.ts` mede duracao e erro de cada consulta nomeada e acumula contadores em memoria (`observability/queryStats.ts`), expostos em `/system-health` (`database.queries`) e na tela "Fontes". Consultas acima de 500ms geram um log de aviso estruturado. Isso e observabilidade leve (contadores desde o start do processo + logs), nao uma APM completa — adequado ao estagio atual (instancia unica, free tier); os logs estruturados (JSON por linha) ficam disponiveis no log viewer do Render para investigacao mais profunda.

## API Publica

Todas as rotas ficam sob `/api/v1`:

- `GET /healthz`
- `GET /system-health`
- `GET /fx/ptax`
- `GET /cloud/catalog`
- `GET /cloud/estimate`
- `GET /labor/profiles`
- `POST /labor/estimate`
- `POST /market-benchmark/search`
- `GET /market-benchmark/history`
- `GET /licenses/catalog`

## Dados E Persistencia

O Postgres (Supabase, ver "Banco De Dados" acima) e a fonte de verdade para catalogo de cloud, precos, cotacao PTAX e historico de benchmark. O cache de resiliencia em arquivo (`data/cache`) continua existindo como fallback de nivel 3 quando `DATABASE_URL` nao esta configurado ou o Postgres esta fora do ar — ele:

- melhora a experiencia quando uma fonte externa e o banco falham juntos;
- nao deve ser usado como registro permanente;
- pode ser perdido em provedores com filesystem efemero, como Render Free (por isso a migracao para Postgres).

Pendente para uma proxima fase: usuarios/acessos, propostas salvas e auditoria de fontes por proposta (a tabela `ingestion_runs` ja cobre auditoria de fontes de precificacao, mas nao de propostas individuais).

## Deploy

O artefato principal e o `Dockerfile`. O `render.yaml` descreve um Web Service gratuito no Render com:

- runtime Docker;
- health check em `/api/v1/healthz`;
- `NODE_ENV=production`;
- variaveis secretas para Basic Auth e conector opcional.

Detalhes:

- [deploy-render.md](deploy-render.md)
- [deploy-teste.md](deploy-teste.md)
- [REQUISITOS-INFRA.md](REQUISITOS-INFRA.md)

## Pendencias Arquiteturais

- Substituir snapshots de CAGED/MTE por pipeline real de ingestao (o MTE so disponibiliza microdados via FTP, sem API — exige um pipeline de download/parse periodico).
- Expandir o PNCP alem da checagem de saude: hoje `pncpCollector.ts` so prova que a API esta no ar (contagem de contratacoes recentes); buscar preco de referencia por item exigiria paginar `/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}` e casar a descricao do item com o catalogo do Pivo.
- Rodar `scripts/deploy-lambda.ps1` (cria a IAM Role/policy, a Lambda e o EventBridge Rule) e configurar `GOOGLE_CLOUD_BILLING_API_KEY` para validar a primeira ingestao AWS/GCP em producao — o coletor GCP em particular usa casamento de SKU por descricao/regiao que so pode ser confirmado com uma chave real.
- Ampliar dimensoes de custo da calculadora cloud: storage (EBS/Persistent Disk), transferencia de dados, banco gerenciado (RDS/Cloud SQL) — hoje cobre so compute on-demand.
- Persistir propostas, usuarios e auditoria de fontes por proposta no Postgres.
- Separar dominio em modulos menores quando o volume de regras crescer.
- Criar MCP server previsto no PRD.
- Publicar workflow CI/CD quando a credencial GitHub tiver escopo `workflow`.
