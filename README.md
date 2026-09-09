# Pivo - Strategic Pricing

Pivo e uma aplicacao full-stack para precificacao de projetos de TI. A solucao consolida custos de mao de obra, infraestrutura cloud, cambio, licencas SaaS e benchmark salarial em uma interface unica, sempre mostrando a origem e o estado de confiabilidade de cada dado.

O projeto atual e a implementacao real sobre o stack existente Node/TypeScript. A visao original do PRD esta preservada em [docs/PRD-original.md](docs/PRD-original.md); a arquitetura implementada esta em [docs/ARQUITETURA.md](docs/ARQUITETURA.md); o historico de mudancas de engenharia/infraestrutura esta em [CHANGELOG.md](CHANGELOG.md); o documento operacional (o que esta no ar, como opera e o que fazer quando quebra) esta em [docs/RUNBOOK.md](docs/RUNBOOK.md).

## O Que Existe Hoje

| Area | Status | Observacao |
| :--- | :--- | :--- |
| Dashboard de fontes | Implementado | Mostra saude, latencia e degradacao das fontes. |
| Mao de obra | Implementado | Perfis profissionais, Fator K, CLT/PJ e filtro por UF/cidade no benchmark. Botao "Limpar dados" reseta o formulario e a busca de benchmark pra comecar do zero. |
| Infra cloud | Implementado | Cloud Architecture Calculator: monta arquiteturas com N servicos (Compute/Storage/Database/Networking/Containers/Serverless/CDN) por AWS/Azure/GCP, com diagrama visual, resumo de custo, exportacao CSV e CRUD completo (criar/editar/duplicar/excluir). Estado vazio tem um "Ver exemplo pronto" (3 servicos AWS pre-configurados, nada salvo) pra avaliar o calculo sem montar do zero. Unica coisa que o produto persiste com nome. Compute (todos providers) e 4 servicos Azure (Storage/SQL/Load Balancer/Functions) tem preco ao vivo/ingestao real; os demais (GCP/AWS nao-compute) sao catalogo estimado com fonte explicita. |
| Licencas | Implementado | Catalogo SaaS com filtros, fontes oficiais, calculo por assentos, conversao para BRL (cotacao PTAX explicita) e exportacao CSV. |
| Cambio PTAX | Implementado | BACEN Olinda API ao vivo, sem chave. |
| PNCP | Implementado (checagem de saude) | API de consulta publica ao vivo, sem chave; aparece em `/system-health`. Ainda nao busca preco de referencia por item. |
| Resiliencia | Implementado | Circuit breaker, retry, cache em disco e fallback estatico. |
| Banco persistente | Implementado | Postgres (Supabase) para catalogo de cloud, precos, PTAX e historico de benchmark. Cache em arquivo continua so como fallback de nivel 3. |
| Observabilidade externa | Implementado | Sentry (error tracking) + UptimeRobot (uptime) + keep-alive do Supabase via cron externo — ver [REQUISITOS-INFRA.md](docs/REQUISITOS-INFRA.md#observabilidade-gratuita-sentry--uptimerobot). |
| Ambiente de teste | Implementado | Docker + Render Free + login com sessao, RBAC e tela propria do produto. URL real: `https://pivo-i8m3.onrender.com`. |
| Identidade visual no produto | Implementado | Tela inicial e hero da visao geral usam os assets em `client/public/brand/`, derivados das referencias em `docs/assets/identidade-visual/`. Layout validado para mobile, desktop, 4K e 8K sem overflow horizontal. |
| CAGED ao vivo | Implementado | Ingestao mensal dos microdados do PDET/MTE (FTP, `.7z`) via GitHub Actions; salario CLT observado por CBO/UF com P25/mediana/P75 e n amostral, aplicado em `/labor/profiles`. Ver [RUNBOOK](docs/RUNBOOK.md#8-enriquecimento-de-dados-o-que-foi-feito-e-o-que-falta). |
| MCP server | Pendente | Previsto no PRD, ainda nao implementado. |
| Multiusuario | Implementado | Login por e-mail/senha com usuarios em Postgres, troca obrigatoria de senha inicial, perfis ADMIN/USER e permissoes por modulo. Decisao de produto: nao havera modulo de "Propostas". |

## Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui (Radix), TanStack Query, React Hook Form + Zod, Framer Motion.
- Backend: Node.js, Express, TypeScript.
- Arquitetura: camadas inspiradas em Clean Architecture (`domain`, `infrastructure`, `presentation`).
- Build: Vite para o cliente e esbuild para o servidor.
- Deploy: Dockerfile unico; recomendado Render Free para testes.

A stack completa — versoes, o porque de cada escolha, as oito fontes de dados com estado e cadencia, e a infraestrutura provedor a provedor — esta em [docs/RUNBOOK.md](docs/RUNBOOK.md#2-stack-da-solução).

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
pnpm run migrate  # Aplica as migrations pendentes (ver "Banco De Dados" abaixo)
pnpm run ingest:caged -- --dry-run  # Ingestao do CAGED (exige curl e 7z no PATH)
pnpm test         # Suite automatizada (exige um Postgres de teste -- ver "Testes" abaixo)
```

## Banco De Dados E Migrations

O schema vive em [server/db/migrations/](server/db/migrations/), um arquivo `.sql` por mudanca,
aplicado em ordem alfabetica por `pnpm run migrate`. O runner registra o que ja rodou na tabela
`schema_migrations` e recusa aplicar de novo; ele tambem compara o checksum de cada arquivo ja
aplicado, entao **migration aplicada e imutavel** — para corrigir algo, crie um arquivo novo.

```bash
pnpm run migrate                # aplica as pendentes
pnpm run migrate -- --dry-run   # so lista o que rodaria
pnpm run migrate -- --baseline  # marca as pendentes como aplicadas SEM executar o SQL
```

`--baseline` serve para um banco que **ja tem o schema**, aplicado antes deste runner existir
(e o caso da Supabase de producao, cujas migrations foram rodadas na mao via MCP). Rodar sem
`--baseline` ali tentaria recriar tabelas existentes e falharia. Rode o baseline uma unica vez
e, dali em diante, use `pnpm run migrate` normalmente.

## Testes

```bash
pnpm test
```

A suite sobe o Express de verdade (supertest) e **escreve num Postgres real**: cria usuarios,
faz login, grava historico de benchmark e apaga tudo no teardown. Por isso ela precisa de um
banco descartavel — nunca aponte `DATABASE_URL` para a Supabase de producao ao rodar os testes,
porque a limpeza final apaga linhas de verdade.

Para um banco local:

```bash
docker run -d --name pivo-test-db -p 5432:5432 \
  -e POSTGRES_USER=pivo -e POSTGRES_PASSWORD=pivo -e POSTGRES_DB=pivo_test \
  postgres:17-alpine

export DATABASE_URL="postgresql://pivo:pivo@localhost:5432/pivo_test"
export DATABASE_SSL=disable
pnpm run migrate
pnpm test
```

No CI isso e feito automaticamente por um service container — ver
[.github/workflows/ci.yml](.github/workflows/ci.yml).

## CI/CD

O pipeline ([.github/workflows/ci.yml](.github/workflows/ci.yml)) roda em todo push e PR, com
quatro jobs; o deploy so acontece se os tres primeiros passarem:

| Job | O que faz | Bloqueia deploy |
| :--- | :--- | :--- |
| `build` | `pnpm run check` (type-check) + `pnpm run build` | Sim |
| `test` | Sobe Postgres 17 efemero, aplica as migrations e roda `pnpm test` | Sim |
| `security` | gitleaks (segredos) + `pnpm audit --prod --audit-level high` (gate) + audit completo (informativo) | Sim |
| `deploy` | Aplica migrations pendentes em producao, dispara o deploy hook do Render e espera `/api/v1/healthz` publicar o commit **deste push** | — |

O gate de auditoria quebra o build em qualquer vulnerabilidade high/critical **nova** nas
dependencias de producao. O passivo conhecido no momento em que o gate foi criado esta listado,
com motivo e caminho de saida de cada item, em `pnpm.auditConfig` no [package.json](package.json)
— essa lista deve encolher, nunca crescer sem justificativa no PR.

Configuracao necessaria no GitHub (Settings > Secrets and variables > Actions):

- Secret `RENDER_DEPLOY_HOOK_URL` — sem ele o job de deploy avisa e passa sem publicar.
- Variable `PRODUCTION_URL` (ex.: `https://pivo-i8m3.onrender.com`) — sem ela o smoke test
  pos-deploy avisa e e pulado.
- Secret `DATABASE_URL` — usado pelo workflow mensal de ingestao do CAGED
  ([ingest-caged.yml](.github/workflows/ingest-caged.yml)). Sem ele so o `dry_run` roda.

Atualizacao de dependencias e automatizada pelo [Dependabot](.github/dependabot.yml)
(npm, GitHub Actions e Docker).

## Variaveis De Ambiente

Veja tambem [.env.example](.env.example).

| Variavel | Obrigatoria | Uso |
| :--- | :--- | :--- |
| `NODE_ENV` | Nao | Use `production` em deploy. |
| `PORT` | Nao | Porta do Express; padrao 3000 em producao e 3001 em dev. |
| `APP_ENV` | Nao | Rotulo de ambiente exibido no rodape do app (ex.: "Homologacao"); nao afeta comportamento. |
| `SESSION_SECRET` | Recomendado | Segredo usado para assinar o cookie de sessao. Gere um valor forte e mantenha entre deploys. |
| `DATABASE_URL` | Recomendado | Postgres/Supabase para usuarios, permissoes, precos e historicos. Sem ele, parte do app usa snapshots/fallbacks, mas login multiusuario depende do banco. |
| `DATABASE_CA_CERT` | Recomendado em prod | Certificado raiz (PEM) do Postgres. Com ele a conexão verifica a identidade do servidor (`rejectUnauthorized: true`) em vez de só criptografar. Ver [RUNBOOK](docs/RUNBOOK.md). |
| `DATABASE_SSL` | Nao | `disable` forca conexao sem TLS (necessario com Postgres local/CI, que sobe sem SSL); `require` forca TLS. Vazio decide pelo host. |
| `ADMIN_NAME` | Apenas seed | Nome do primeiro administrador ao rodar `pnpm run seed:admin`. Nao deixe configurado permanentemente. |
| `ADMIN_EMAIL` | Apenas seed | E-mail do primeiro administrador ao rodar `pnpm run seed:admin`. Nao deixe configurado permanentemente. |
| `ADMIN_INITIAL_PASSWORD` | Apenas seed | Senha inicial do primeiro administrador ao rodar `pnpm run seed:admin`. Nao deixe configurado permanentemente. |
| `MARKET_BENCHMARK_CONNECTOR_URL` | Nao | Conector externo para benchmark salarial ao vivo. |
| `SENTRY_DSN` | Nao | DSN opcional para error tracking no Sentry. |
| `GOOGLE_CLOUD_BILLING_API_KEY` | Nao | Usada apenas para ingestao manual/local de catalogo GCP, nao pelo app web no Render. |

BACEN PTAX e Azure Retail Prices API nao exigem chave.

Para criar o primeiro administrador em um ambiente com `DATABASE_URL` configurado:

```bash
ADMIN_NAME="Administrador Pivo" \
ADMIN_EMAIL="admin@exemplo.com" \
ADMIN_INITIAL_PASSWORD="defina-uma-senha-forte" \
pnpm run seed:admin
```

## Estrutura

```text
Pivo/
|-- client/
|   |-- public/brand/           # Imagens usadas na tela inicial e visao geral
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
- montagem de arquitetura de cloud multi-servico (Cloud Architecture Calculator), com diagrama visual e custo mensal/anual;
- composicao de licencas por fornecedor e numero de assentos;
- publicacao de ambiente de teste.

Navegacao usa rotas reais (wouter) por modulo — `/`, `/mao-de-obra`, `/infra-cloud`,
`/licencas`, `/fontes`, `/administracao/usuarios` — favoritar, compartilhar link e usar o botao Voltar do navegador
funcionam normalmente.

## Identidade Visual No Front

Os arquivos de referencia ficam em `docs/assets/identidade-visual/`. Os arquivos que o Vite serve em runtime ficam em `client/public/brand/`:

- `tela-login.png`: direcao visual da tela inicial; usada como fundo com overlay escuro para manter contraste do formulario.
- `visao-geral.png`: direcao visual do dashboard; usada como midia do lado direito do hero da visao geral.

Esses assets devem orientar composicao, clima, iconografia e profundidade. A interface continua sendo HTML/CSS/React funcional; nao deve virar uma captura estatica da imagem.

## API

Todas as rotas ficam sob `/api/v1`.

| Metodo | Rota | Descricao |
| :--- | :--- | :--- |
| `GET` | `/healthz` | Health check leve para orquestradores. |
| `GET` | `/system-health` | Estado agregado das fontes de dados. |
| `GET` | `/fx/ptax` | Cambio PTAX via BACEN com resiliencia. |
| `GET` | `/cloud/services` | Catalogo pesquisavel de servicos cloud (busca + filtro). |
| `POST` | `/cloud/services/:serviceId/price` | Calcula o preco de 1 servico. |
| `POST` | `/cloud/architectures` | Cria uma arquitetura (N servicos). |
| `GET` | `/cloud/architectures` | Lista arquiteturas salvas. |
| `GET` | `/cloud/architectures/:id` | Detalhe de uma arquitetura. |
| `PUT` | `/cloud/architectures/:id` | Atualiza uma arquitetura. |
| `DELETE` | `/cloud/architectures/:id` | Exclui uma arquitetura. |
| `POST` | `/cloud/architectures/:id/duplicate` | Duplica uma arquitetura. |
| `GET` | `/labor/profiles` | Perfis profissionais de mao de obra. |
| `POST` | `/labor/estimate` | Calculo de custo/hora e taxa-hora sugerida. |
| `POST` | `/market-benchmark/search` | Benchmark salarial por cargo, UF e cidade. |
| `GET` | `/market-benchmark/history` | Historico das buscas recentes. |
| `GET` | `/licenses/catalog` | Catalogo de licencas SaaS. |
| `GET` | `/auth/session` | Estado da sessao autenticada. |
| `POST` | `/auth/login` | Login por e-mail/senha. |
| `POST` | `/auth/logout` | Encerra a sessao. |
| `POST` | `/auth/change-password` | Troca senha inicial/atual. |
| `GET` | `/admin/users` | Lista usuarios (ADMIN). |
| `POST` | `/admin/users` | Cria usuario (ADMIN). |
| `PUT` | `/admin/users/:id` | Atualiza usuario/permissoes (ADMIN). |
| `POST` | `/admin/users/:id/activate` | Ativa usuario (ADMIN). |
| `POST` | `/admin/users/:id/deactivate` | Desativa usuario (ADMIN). |

`/system-health` tambem devolve `meta: { version, commit, environment }` (versao do
`package.json`, commit curto e o rotulo de `APP_ENV`), exibido no rodape do app.

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
  -e SESSION_SECRET='gere-um-segredo-forte' \
  -e DATABASE_URL='postgresql://...' \
  pivo:test
```

## Roadmap Tecnico

1. Ligar ingestao real de CAGED/MTE (exige pipeline de download/parse dos microdados via FTP, sem API disponivel).
2. Expandir o PNCP de checagem de saude para preco de referencia por item (hoje so prova que a API esta no ar).
3. Trocar snapshots AWS/GCP por coletores dedicados.
4. ~~Persistir simulacoes/propostas em Postgres~~ — decisao de produto: nao havera modulo de propostas; a unica persistencia por nome e a arquitetura de cloud salva (ja implementado).
5. Implementar MCP server para consumo por assistentes.
6. Criar pipeline CI/CD quando o token GitHub tiver escopo `workflow`.
7. Trocar o preco de catalogo (estimado) dos servicos alem de compute por preco real. Azure ja feito (Storage/SQL/Load Balancer/Functions, ao vivo via Azure Retail Prices API — ver CHANGELOG.md). GCP e AWS ainda pendentes: exigem estender a ingestao periodica da Lambda (nao dá pra chamar ao vivo por requisicao do app web, mesmo motivo do compute — custo/credencial).

## Licenca

MIT. Veja [LICENSE](LICENSE).
