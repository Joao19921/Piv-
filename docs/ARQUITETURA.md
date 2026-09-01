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
- `collectors/azureCollector.ts`: Azure Retail Prices API.
- `collectors/staticFallbacks.ts`: valores estaticos para operacao degradada.
- `resilience/resilienceManager.ts`: politica de resiliencia.
- `cache/fileCache.ts`: cache JSON em `data/cache`.

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
| BACEN PTAX | API Olinda publica | Ao vivo |
| Azure Retail Prices | API publica da Microsoft | Ao vivo |
| AWS EC2 | Snapshot oficial em catalogo local | Fallback/snapshot |
| GCP Compute | Snapshot oficial em catalogo local | Fallback/snapshot |
| Perfis CAGED/MTE | Catalogo parametrizado local | Snapshot |
| Benchmark salarial | Modelo local + opcional `MARKET_BENCHMARK_CONNECTOR_URL` | Snapshot ou conector |
| Licencas SaaS | Catalogo local com URLs oficiais | Snapshot |
| PNCP | Nao implementado | Pendente |

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

Hoje nao existe banco de dados. O unico armazenamento e o cache de resiliencia em `data/cache`, que:

- melhora a experiencia quando uma fonte externa falha;
- nao deve ser usado como registro permanente;
- pode ser perdido em provedores com filesystem efemero, como Render Free.

Para uma segunda fase, recomenda-se Postgres para:

- usuarios e acessos;
- propostas salvas;
- snapshots versionados de catalogo;
- historico de benchmark;
- auditoria de fontes utilizadas em cada proposta.

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

- Substituir snapshots de CAGED/MTE por pipeline real de ingestao.
- Implementar PNCP.
- Implementar coletores AWS Pricing API e GCP Cloud Billing Catalog.
- Adicionar banco persistente.
- Separar dominio em modulos menores quando o volume de regras crescer.
- Criar MCP server previsto no PRD.
- Publicar workflow CI/CD quando a credencial GitHub tiver escopo `workflow`.
