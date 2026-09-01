# Arquitetura Atual — Pivô

Este documento descreve a arquitetura **realmente implementada** do Pivô, em contraste com a arquitetura aspiracional original preservada em [`PRD-original.md`](PRD-original.md).

## Decisão de stack: Node/TypeScript em vez de Python/FastAPI

O PRD original especificava um backend Python (FastAPI) + MCP server separado, com Clean Architecture e coletores independentes por fonte externa. Na prática, o projeto já existia como um front-end React/Vite + um Express mínimo (gerado via Manus AI como protótipo visual). Diante dessa base, a decisão tomada foi **continuar em Node/TypeScript dentro do mesmo Express**, replicando as mesmas camadas (domain → infrastructure → presentation) em vez de subir um segundo runtime.

**Motivo:** um único processo/linguagem para rodar e implantar, sem o custo operacional de manter dois runtimes (Node + Python) para uma equipe pequena. A troca não compromete os princípios do PRD (separação de regras de negócio, resiliência em camadas, rastreabilidade de origem do dado) — apenas o veículo de implementação.

O MCP server (Fase 3 do PRD) **não foi implementado ainda**; ver [Pendências](#pendências-vs-prd-original).

## Visão geral

```text
┌─────────────────────────────────────────────────────────────────┐
│                      CLIENTE (navegador)                        │
│   React 19 + Vite + Tailwind v4 + shadcn/ui + TanStack Query     │
│   client/src/pages/Home.tsx (shell + módulos) + hooks/ + lib/api │
└───────────────────────────┬───────────────────────────────────--┘
                             │ HTTPS / REST JSON  (/api/v1/*)
                             ▼
┌───────────────────────────────────────────────────────────────--┐
│                    SERVIDOR (Node.js + Express)                 │
│                                                                  │
│  presentation/app.ts        rotas REST, validação de entrada     │
│         │                                                        │
│  domain/services/           regras de negócio puras:             │
│    - laborPricing.ts          Fator K → custo/hora → taxa sugerida│
│    - cloudPricing.ts          unitário × instâncias × horas × fx │
│    - cloudCatalog.ts          catálogo estático de regiões/SKUs  │
│    - catalogs.ts              perfis de mão de obra + licenças   │
│    - marketBenchmark.ts       inferência de perfil/senioridade/  │
│                                região + orquestra conector/cache  │
│         │                                                        │
│  infrastructure/                                                 │
│    - collectors/            BACEN PTAX, Azure Retail Prices,     │
│                              fallbacks estáticos (AWS/GCP)        │
│    - resilience/             circuit breaker + retry + fallback  │
│    - cache/                  cache write-through em disco (JSON) │
└──────────────┬──────────────────────────┬────────────────────--─┘
               │                          │
               ▼                          ▼
   ┌───────────────────┐      ┌────────────────────────┐
   │ BACEN Olinda API  │      │ Azure Retail Prices API│
   │ (público, sem chave)     │ (público, sem chave)   │
   └───────────────────┘      └────────────────────────┘
```

Um único processo Express serve a API (`/api/v1/*`) e, em produção, também os arquivos estáticos do build do front-end — não há dois deploys separados.

## Camada de resiliência

`server/src/infrastructure/resilience/resilienceManager.ts` implementa as 4 camadas de proteção do PRD original, de fato:

1. **Circuit breaker** — em memória, por `serviceName`. Abre após 2 falhas consecutivas, meio-abre depois de 30s.
2. **Retry com backoff exponencial** — 2 tentativas por padrão, com espera crescente entre elas.
3. **Cache local (write-through)** — `infrastructure/cache/fileCache.ts` grava cada resposta bem-sucedida em `data/cache/*.json`; uma falha ao vivo primeiro tenta ler esse cache.
4. **Fallback estático** — se não há cache (primeira execução) nem resposta ao vivo, cada coletor tem um valor de contingência fixo (ex.: PTAX 5,40 hardcoded, tabela de USD/hora por região).

Toda chamada retorna o formato único `ResilienceResult<T>`:

```ts
{ status: "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE", source, timestamp, warning?, data }
```

O front-end nunca esconde isso — o badge de cada fonte e as mensagens de aviso na UI vêm diretamente desse campo `status`/`warning`, sem tradução "otimista".

## Fontes de dados — o que é real hoje

| Fonte | Coletor | Ao vivo? |
| :--- | :--- | :--- |
| Câmbio (PTAX) | `collectors/bacenCollector.ts` | ✅ API Olinda do BACEN, pública |
| Preço unitário Azure | `collectors/azureCollector.ts` | ✅ Azure Retail Prices API, pública, por SKU ARM + região |
| Preço unitário AWS/GCP | `domain/services/cloudCatalog.ts` (dados embutidos) | ⚠️ Snapshot oficial parametrizado por SKU/região — sem coletor dedicado (exigiria credenciais AWS/GCP) |
| Perfis de mão de obra (CAGED) | `domain/services/catalogs.ts` | ⚠️ Snapshot parametrizado |
| Benchmark salarial | `domain/services/marketBenchmark.ts` | ⚠️ Snapshot parametrizado por padrão; vira `LIVE_CONNECTOR` automaticamente se `MARKET_BENCHMARK_CONNECTOR_URL` estiver configurado |
| Licenciamento SaaS | `domain/services/catalogs.ts` | ⚠️ Snapshot baseado em páginas oficiais de preço |
| PNCP | não implementado | ❌ |

## Front-end

Estrutura feature-first dentro de um único arquivo de shell (`client/src/pages/Home.tsx`), que renderiza os módulos (Dashboard, Mão de obra, Infra cloud, Licenças, Propostas, Fontes) conforme a navegação. Estado de servidor é gerenciado inteiramente por TanStack Query (`client/src/hooks/*`), com `staleTime`/`refetchInterval` ajustados por tipo de dado (catálogos quase estáticos vs. `system-health` que repolla a cada 30s). Não há Redux/Zustand — o estado de UI local usa `useState` diretamente nos componentes de cada módulo.

## Infraestrutura

- **`Dockerfile`**: build multi-stage (build com pnpm + Vite/esbuild, runtime `node:22-alpine` enxuto).
- **`.env.example`**: variáveis suportadas (ver README).
- **Basic Auth de teste**: `server/index.ts` protege o app inteiro com Basic Auth simples quando `TEST_ACCESS_USER`/`TEST_ACCESS_PASSWORD` estão definidos em produção — pensado para ambientes de teste compartilhados, não para produção real com múltiplos usuários.
- **`.github/workflows/ci.yml`**: instala dependências, roda type-check e build a cada push/PR. Não há pipeline de deploy contínuo ainda — publicar um ambiente segue o passo a passo manual em [`deploy-teste.md`](deploy-teste.md).
- **Persistência**: nenhuma além do cache em arquivo (`data/cache/`, git-ignorado). Não há banco de dados.

## Pendências vs. PRD original

O que o PRD original previa e ainda **não** existe nesta implementação:

- Backend Python/FastAPI e servidor MCP (FastMCP) para consumo por assistentes de IA/IDEs.
- Ingestão real de CAGED (MTE) e PNCP (hoje são snapshots/estão marcados como não implementados).
- Coletores dedicados de AWS Pricing API e GCP Billing Catalog API (hoje snapshot estático parametrizado).
- Banco de dados persistente (PostgreSQL/DuckDB) — hoje é só cache em arquivo, adequado para uma instância única, não para múltiplas réplicas.
- Pipeline de deploy contínuo automatizado (hoje é Docker + publicação manual).
