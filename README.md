# Pivo - Strategic Pricing

Pivo e uma aplicacao full-stack para precificacao de projetos de TI. A solucao consolida custos de mao de obra, infraestrutura cloud, cambio, licencas SaaS e benchmark salarial em uma interface unica, sempre mostrando a origem e o estado de confiabilidade de cada dado.

O projeto atual e a implementacao real sobre o stack existente Node/TypeScript. A visao original do PRD esta preservada em [docs/PRD-original.md](docs/PRD-original.md); a arquitetura implementada esta em [docs/ARQUITETURA.md](docs/ARQUITETURA.md); o historico de mudancas de engenharia/infraestrutura esta em [CHANGELOG.md](CHANGELOG.md).

## O Que Existe Hoje

| Area | Status | Observacao |
| :--- | :--- | :--- |
| Dashboard de fontes | Implementado | Mostra saude, latencia e degradacao das fontes. |
| Mao de obra | Implementado | Perfis profissionais, Fator K, CLT/PJ e filtro por UF/cidade no benchmark. |
| Infra cloud | Implementado | Catalogo por provider, regiao, familia e SKU; Azure ao vivo, AWS/GCP por snapshot oficial. |
| Licencas | Implementado | Catalogo SaaS com filtros, fontes oficiais e calculo por assentos. |
| Cambio PTAX | Implementado | BACEN Olinda API ao vivo, sem chave. |
| PNCP | Implementado (checagem de saude) | API de consulta publica ao vivo, sem chave; aparece em `/system-health`. Ainda nao busca preco de referencia por item. |
| Resiliencia | Implementado | Circuit breaker, retry, cache em disco e fallback estatico. |
| Banco persistente | Implementado | Postgres (Supabase) para catalogo de cloud, precos, PTAX e historico de benchmark. Cache em arquivo continua so como fallback de nivel 3. |
| Observabilidade externa | Implementado | Sentry (error tracking) + UptimeRobot (uptime) + keep-alive do Supabase via cron externo — ver [REQUISITOS-INFRA.md](docs/REQUISITOS-INFRA.md#observabilidade-gratuita-sentry--uptimerobot). |
| Ambiente de teste | Implementado | Docker + Render Free + login com sessao. URL real: `https://pivo-i8m3.onrender.com`. |
| CAGED ao vivo | Pendente | MTE so disponibiliza microdados via FTP (sem API); hoje aparece como snapshot/fallback. |
| MCP server | Pendente | Previsto no PRD, ainda nao implementado. |
| Propostas/usuarios persistidos | Pendente | Postgres ja existe (ver acima), mas ainda sem entidades de `Proposal`/`User`/auditoria por proposta. |

## Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, TanStack Query, Recharts.
- Backend: Node.js, Express, TypeScript.
- Arquitetura: camadas inspiradas em Clean Architecture (`domain`, `infrastructure`, `presentation`).
- Build: Vite para o cliente e esbuild para o servidor.
- Deploy: Dockerfile unico; recomendado Render Free para testes.

## Como Rodar Localmente

Pre-requisitos:

- Node.js 22+
- pnpm 10+

```bash
pnpm install
pnpm run dev
```

URLs locais:

- Frontend: <http://localhost:3000>
- API: <http://localhost:3001/api/v1>

Comandos uteis:

```bash
pnpm run check    # Type-check
pnpm run build    # Build de producao em dist/
pnpm run start    # Roda o build em modo producao
pnpm run format   # Prettier
```

## Variaveis De Ambiente

Veja tambem [.env.example](.env.example).

| Variavel | Obrigatoria | Uso |
| :--- | :--- | :--- |
| `NODE_ENV` | Nao | Use `production` em deploy. |
| `PORT` | Nao | Porta do Express; padrao 3000 em producao e 3001 em dev. |
| `TEST_ACCESS_USER` | Nao | Usuario da tela de login (sessao) do ambiente de teste. |
| `TEST_ACCESS_PASSWORD` | Nao | Senha da tela de login (sessao) do ambiente de teste. |
| `MARKET_BENCHMARK_CONNECTOR_URL` | Nao | Conector externo para benchmark salarial ao vivo. |

BACEN PTAX e Azure Retail Prices API nao exigem chave.

## Estrutura

```text
Pivo/
|-- client/
|   `-- src/
|       |-- pages/Home.tsx        # Interface principal e modulos
|       |-- hooks/                # Hooks de dados com TanStack Query
|       |-- lib/api.ts            # Cliente HTTP tipado
|       `-- components/ui/        # Componentes shadcn/ui
|-- server/
|   |-- index.ts                  # Bootstrap Express, static files e gate de sessao (login)
|   `-- src/
|       |-- domain/services/      # Regras de precificacao e catalogos
|       |-- infrastructure/       # Coletores, cache e resiliencia
|       `-- presentation/app.ts   # Rotas REST /api/v1
|-- docs/
|   |-- ARQUITETURA.md
|   |-- FLUXOS.md
|   |-- REQUISITOS-INFRA.md
|   |-- deploy-render.md
|   |-- deploy-teste.md
|   `-- PRD-original.md
|-- Dockerfile
|-- render.yaml
`-- package.json
```

## Fluxos Do Produto

Os fluxos de uso e operacao estao documentados em [docs/FLUXOS.md](docs/FLUXOS.md):

- validacao de saude das fontes;
- benchmark de mao de obra por cargo, UF e cidade;
- calculo de taxa-hora com perfil profissional;
- estimativa de infra cloud por provider/regiao/SKU;
- composicao de licencas por fornecedor e numero de assentos;
- publicacao de ambiente de teste.

## API

Todas as rotas ficam sob `/api/v1`.

| Metodo | Rota | Descricao |
| :--- | :--- | :--- |
| `GET` | `/healthz` | Health check leve para orquestradores. |
| `GET` | `/system-health` | Estado agregado das fontes de dados. |
| `GET` | `/fx/ptax` | Cambio PTAX via BACEN com resiliencia. |
| `GET` | `/cloud/catalog` | Regioes e SKUs disponiveis por provider. |
| `GET` | `/cloud/estimate` | Estimativa mensal de cloud. |
| `GET` | `/labor/profiles` | Perfis profissionais de mao de obra. |
| `POST` | `/labor/estimate` | Calculo de custo/hora e taxa-hora sugerida. |
| `POST` | `/market-benchmark/search` | Benchmark salarial por cargo, UF e cidade. |
| `GET` | `/market-benchmark/history` | Historico das buscas recentes. |
| `GET` | `/licenses/catalog` | Catalogo de licencas SaaS. |

## Infraestrutura Gratuita Recomendada

Para acesso de teste do time, a recomendacao atual e **Render Free Web Service** usando o Dockerfile deste repositorio.

Motivos:

- suporta app full-stack com Express escutando porta HTTP;
- permite deploy por Docker sem reescrever a API como serverless;
- oferece TLS gerenciado e URL publica;
- tem plano gratuito adequado para ambiente de teste;
- o `render.yaml` ja esta versionado.

Limitacoes importantes:

- o servico gratuito dorme apos inatividade;
- o filesystem e efemero, entao o cache em `data/cache` nao deve ser tratado como banco;
- nao e ambiente de producao com SLA.

Detalhes e alternativas estao em [docs/REQUISITOS-INFRA.md](docs/REQUISITOS-INFRA.md). O passo a passo para subir esta em [docs/deploy-render.md](docs/deploy-render.md).

## Build Com Docker

```bash
docker build -t pivo:test .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e TEST_ACCESS_USER=pivo-teste \
  -e TEST_ACCESS_PASSWORD='defina-uma-senha-forte' \
  pivo:test
```

## Roadmap Tecnico

1. Ligar ingestao real de CAGED/MTE (exige pipeline de download/parse dos microdados via FTP, sem API disponivel).
2. Expandir o PNCP de checagem de saude para preco de referencia por item (hoje so prova que a API esta no ar).
3. Trocar snapshots AWS/GCP por coletores dedicados.
4. Persistir simulacoes/propostas em Postgres.
5. Implementar MCP server para consumo por assistentes.
6. Criar pipeline CI/CD quando o token GitHub tiver escopo `workflow`.

## Licenca

MIT. Veja [LICENSE](LICENSE).
