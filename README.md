# Pivô — Engine de Precificação Estratégica de TI

Pivô transforma fontes de custo dispersas (mão de obra, infraestrutura cloud, câmbio, licenciamento de software e benchmark salarial de mercado) em uma base defensável para precificar projetos e propostas de TI. Cada número mostra sua origem, se é dado ao vivo ou snapshot, e quando foi atualizado pela última vez — nunca escondendo a procedência do dado atrás de uma tela bonita.

> Este repositório é a implementação real do projeto. A visão original (arquitetura aspiracional em Python/FastAPI + MCP) está preservada em [`docs/PRD-original.md`](docs/PRD-original.md); o que foi de fato construído — e por quê diverge do PRD — está documentado em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Módulos

| Módulo | O que faz |
| :--- | :--- |
| **Visão geral** | Dashboard com margem média, pipeline de propostas e integridade das fontes de dados. |
| **Mão de obra** | Calculadora de taxa-hora (Fator K) por perfil profissional (CLT/PJ) + busca de benchmark salarial por cargo/UF/cidade (Robert Half, Michael Page, Glassdoor, Indeed), com histórico de consultas. |
| **Infra cloud** | Estimativa mensal por provedor (AWS/Azure/GCP) × família × SKU × região, com câmbio BACEN aplicado em tempo real. |
| **Licenças** | Catálogo de custos de licenciamento SaaS (GitHub, Microsoft 365, Datadog, Power BI, Jira, Slack) com calculadora por número de assentos. |
| **Propostas** | Fila de rascunhos que preserva as premissas e o estado das fontes no momento da simulação. |
| **Fontes** | Painel de observabilidade: mostra circuit breaker, retry, cache local e fallback estático acontecendo de verdade, fonte a fonte. |

## Stack

- **Front-end:** React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui (Radix) + TanStack Query + Recharts.
- **Back-end:** Node.js + Express (TypeScript), em camadas inspiradas em Clean Architecture (`domain` → `infrastructure` → `presentation`).
- **Dados externos:** BACEN (PTAX) e Azure Retail Prices API consultados ao vivo; demais fontes documentadas como snapshot/fallback (ver [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)).
- **Empacotamento:** pnpm workspaces único, build via Vite (front) + esbuild (back), Docker multi-stage para produção.

## Como rodar localmente

Pré-requisitos: Node.js 22+, [pnpm](https://pnpm.io/) 10+.

```bash
pnpm install

# Sobe o front-end (Vite, porta 3000) e a API (Express, porta 3001) juntos
pnpm run dev
```

Acesse <http://localhost:3000> — o Vite faz proxy de `/api` para a API em `:3001`.

Outros comandos úteis:

```bash
pnpm run check    # type-check (tsc --noEmit)
pnpm run build    # build de produção (client + server) em dist/
pnpm run start    # roda o build de produção (requer NODE_ENV=production)
pnpm run format    # prettier --write
```

### Docker

```bash
docker build -t pivo:test .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e TEST_ACCESS_USER=pivo-teste \
  -e TEST_ACCESS_PASSWORD='defina-uma-senha-forte' \
  pivo:test
```

Veja [`docs/deploy-teste.md`](docs/deploy-teste.md) para o passo a passo de publicar um ambiente de teste protegido por Basic Auth.

### CI/CD

- **CI** (`.github/workflows/ci.yml`): a cada push/PR, instala dependências, roda type-check e build.
- **CD**: se o CI passar em `master`, dispara o deploy hook do [Render](https://render.com) (blueprint em [`render.yaml`](render.yaml)). Configuração única necessária: veja [`docs/deploy-render.md`](docs/deploy-render.md).

### Variáveis de ambiente

Veja [`.env.example`](.env.example). Nenhuma é obrigatória para rodar em desenvolvimento — BACEN PTAX e Azure Retail Prices API são públicas e não exigem chave.

| Variável | Obrigatória | Descrição |
| :--- | :--- | :--- |
| `NODE_ENV` | não | `production` habilita servir o build estático + Basic Auth opcional. |
| `PORT` | não | Porta do servidor Express (padrão `3000` em produção, `3001` em dev). |
| `TEST_ACCESS_USER` / `TEST_ACCESS_PASSWORD` | não | Se ambas definidas em produção, protege o app inteiro com Basic Auth (útil para ambientes de teste). |
| `MARKET_BENCHMARK_CONNECTOR_URL` | não | Conector externo para benchmark salarial ao vivo. Sem isso, o benchmark usa um snapshot parametrizado local. |

## Estrutura do projeto

```text
Pivô/
├── client/                  # Front-end (Vite + React)
│   └── src/
│       ├── pages/Home.tsx   # Shell do produto + todos os módulos (single-page, feature-first)
│       ├── hooks/           # useSystemHealth, useCloudCatalog, useCloudEstimate, useLaborCatalog,
│       │                    # useLaborEstimate, useLicenseCatalog, useMarketBenchmark...
│       ├── lib/api.ts       # Cliente HTTP tipado para a API
│       └── components/ui/   # shadcn/ui
├── server/
│   ├── index.ts             # Bootstrap do Express (API + estáticos em produção + Basic Auth de teste)
│   └── src/
│       ├── domain/services/        # Regras de negócio puras (Fator K, estimativa cloud, catálogos, benchmark)
│       ├── infrastructure/
│       │   ├── collectors/         # BACEN, Azure Retail Prices, fallbacks estáticos
│       │   ├── resilience/         # Circuit breaker + retry + fallback (resilienceManager.ts)
│       │   └── cache/              # Cache local em arquivo (data/cache/*.json)
│       └── presentation/app.ts     # Rotas REST (/api/v1/*)
├── docs/
│   ├── ARQUITETURA.md       # Arquitetura atual, decisões e o que ainda falta
│   ├── PRD-original.md      # Visão/arquitetura aspiracional original (histórico)
│   └── deploy-teste.md      # Como publicar um ambiente de teste
├── Dockerfile
└── .github/workflows/ci.yml # Build + type-check em cada push/PR
```

## Endpoints da API

Todas as rotas ficam sob `/api/v1`. Toda resposta que depende de uma fonte externa segue o formato `{ status, source, timestamp, warning?, data }`, onde `status` é `OPERATIONAL | DEGRADED | FALLBACK_STALE | OFFLINE`.

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `GET` | `/system-health` | Estado agregado de todas as fontes de dados. |
| `GET` | `/fx/ptax` | Cotação PTAX (BACEN), com fallback em cache/estático. |
| `GET` | `/cloud/catalog` | Catálogo de regiões e SKUs por provedor. |
| `GET` | `/cloud/estimate` | Estimativa mensal (`provider`, `region`, `skuId`, `instances`, `hours`). |
| `GET` | `/labor/profiles` | Catálogo de perfis profissionais (snapshot CAGED/MTE). |
| `POST` | `/labor/estimate` | Calcula taxa-hora (`monthlySalary`, `factorK`, `marginPct`, `profileId?`). |
| `POST` | `/market-benchmark/search` | Busca benchmark salarial por cargo/UF/cidade. |
| `GET` | `/market-benchmark/history` | Histórico das últimas buscas de benchmark. |
| `GET` | `/licenses/catalog` | Catálogo de custos de licenciamento SaaS. |

## Estado da integração de dados

| Fonte | Status hoje | Observação |
| :--- | :--- | :--- |
| BACEN PTAX | ✅ Ao vivo | API Olinda pública, sem chave. |
| Azure Retail Prices API | ✅ Ao vivo | Pública, sem chave. |
| AWS EC2 / GCP Compute | ⚠️ Snapshot oficial | Preços parametrizados a partir das páginas oficiais; coletor dedicado ainda não ligado (precisa de credenciais). |
| CAGED/MTE (perfis de mão de obra) | ⚠️ Snapshot | Ingestão real do CAGED ainda não implementada. |
| Benchmark salarial (Robert Half, Michael Page, Glassdoor, Indeed) | ⚠️ Snapshot parametrizado | Vira ao vivo automaticamente se `MARKET_BENCHMARK_CONNECTOR_URL` for configurado. |
| Licenciamento SaaS | ⚠️ Snapshot | Baseado em páginas oficiais de preço; sem conectores comerciais por fornecedor ainda. |
| PNCP | ❌ Não implementado | Próxima fase. |

## Roadmap

- [ ] Ingestão real de CAGED/MTE e PNCP.
- [ ] Coletores dedicados de AWS Pricing API e GCP Billing Catalog API.
- [ ] Persistência real (Postgres/DuckDB) no lugar do cache em arquivo.
- [ ] Servidor MCP para expor as ferramentas de precificação a assistentes de IA.
- [ ] Definir e provisionar infraestrutura de deploy contínuo (hoje há apenas Docker + um passo manual de teste).

## Licença

MIT — veja [`LICENSE`](LICENSE).
