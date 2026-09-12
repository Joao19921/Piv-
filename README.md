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

## Roadmap

Direção de **produto**. A dívida de engenharia e operação vive em
[docs/RUNBOOK.md](docs/RUNBOOK.md#7-pendências-conhecidas), com 14 pendências ordenadas por risco.

### Entregue

| | Estado |
| :--- | :--- |
| **Ingestão real do CAGED/MTE** | Lote mensal no GitHub Actions: baixa o `.7z` do FTP do PDET, filtra os CBOs de TI e agrega P25/mediana/P75 por CBO e UF. Validado na competência 2026-07 — 4,4 M linhas, 14.405 admissões, 84 recortes gravados |
| **SISP como fonte oficial** | As Portarias SGD/MGI deixaram de ser rótulo `FALLBACK_STALE` e viraram fonte com proveniência navegável, ao lado do valor de mercado |
| **Esteira de CI/CD** | 4 jobs com gate real; deploy aplica migrations em produção e valida que o commit do push subiu |
| **Mapeamento de CBO corrigido** | 66 dos 73 perfis; cargos que a CBO 2002 não prevê ficaram sem código, em vez de receber um "próximo" |
| **Preço ao vivo Azure** | Storage, SQL, Load Balancer e Functions via Azure Retail Prices API |
| ~~Persistir propostas em Postgres~~ | Decisão de produto: não haverá módulo de propostas. A única persistência por nome é a arquitetura de cloud salva |
| ~~Benchmark Worker~~ | Decisão de produto (2026-09-12): removido por completo (worker Python, tela `/administracao/benchmark-worker`, schema `benchmark_*`). Indeed/Glassdoor/InfoJobs nunca saíram de `DISABLED` por falta de autorização, e a única via legítima que restava (registro manual de guia público) foi descontinuada — automatizar a coleta violaria o ToS dessas fontes, e o produto decidiu não sustentar o fluxo manual. Ver `CHANGELOG.md` |

### Próximo, em ordem de valor

1. **Mostrar a divergência mercado × oficial na tela.** A API já devolve `observed` (CAGED),
   `referenciaOficial` (SISP) e `coverage`; a tela de Mão de obra ainda ignora os três. O dado
   mais valioso que o produto tem hoje não está visível: a tabela oficial **superprecifica
   suporte e redes em ~40%** e **subprecifica banco de dados e gerência em 20-42%** frente ao que
   o mercado paga. É o argumento que sustenta uma negociação, e está escondido atrás da API.

2. **Conferir a Portaria SGD/MGI nº 5.921/2026.** Ela atualizou a nº 1.070/2023, e os valores de
   infraestrutura no catálogo ainda vêm da nº 6.055/2025 — podem estar superados. Exige ler o
   anexo novo, atualizar `catalogs.ts` e rodar `pnpm run ingest:sisp`.

3. **Busca livre por cargo, UF e cidade.** O hook `MARKET_BENCHMARK_CONNECTOR_URL` está escrito
   em `marketBenchmark.ts` desde o começo e nunca foi ligado. Com `salary_observations`
   populado, ele passa a ter o que servir — inclusive o cache de 10 dias previsto no desenho
   original.

4. **RAIS anual** para recorte por **município**. O CAGED mensal só sustenta amostra por UF; a
   RAIS é bem maior e permitiria descer ao município sem violar a amostra mínima. Mesmo FTP,
   arquivo bem mais pesado.

5. **IBGE / SIDRA (PNAD Contínua).** Cobriria parte dos **36 perfis sem CBO** — Cientista de
   Dados, Engenheiro de IA, UX/UI, Scrum Master —, que hoje seguem só com estimativa por não
   existirem na CBO 2002. API pública, ainda não sondada.

6. **Convenções coletivas (Sistema Mediador/MTE).** Piso legal por sindicato e UF. Numa
   negociação costuma ser o argumento decisivo, e nenhuma das fontes atuais o cobre.

7. **Preço real para GCP e AWS fora de compute.** Hoje é catálogo estimado com fonte explícita.
   Exige estender a ingestão da Lambda — não dá para chamar ao vivo por requisição, mesmo motivo
   do compute (custo e credencial).

8. **MCP server** para consumo por assistentes. Previsto no PRD original, nunca implementado.

### Avaliado e descartado

Registrado para não se repetir o esforço.

| | Por quê |
| :--- | :--- |
| **Scraping de Glassdoor/Indeed** | Os termos de uso proíbem, e a proposta previa contornar CAPTCHA com sessão persistida — burla de controle de acesso. O agravante: o Pivô estima custo para contratação pública, onde a fonte precisa ser citável num processo. "Raspagem não autorizada" não sustenta estimativa diante de TCU/CGU |
| **PNCP como preço de referência por item** | Sondado contra a API real: só **0,63%** das contratações são TI *e* mão de obra (achá-las exigiria varrer ~275 mil por trimestre); a API **bloqueia** após algumas centenas de chamadas; a unidade de medida não é padronizada (`UND SERVIÇO T`, não `POSTO`/`HORA`/`UST`), então os valores não se comparam entre si; e a descrição não identifica cargo nem senioridade. Detalhes e medições em [RUNBOOK §8](docs/RUNBOOK.md). Só faria sentido reabrir se o PNCP passar a oferecer filtro por objeto ou dump em lote |

## Licenca

MIT. Veja [LICENSE](LICENSE).
