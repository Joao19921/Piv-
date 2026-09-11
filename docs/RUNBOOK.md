# Runbook — Pivô

Documento operacional: **o que está no ar, como opera, e o que fazer quando algo quebra.**

Complementa, sem repetir: [ARQUITETURA.md](ARQUITETURA.md) (decisões de desenho),
[REQUISITOS-INFRA.md](REQUISITOS-INFRA.md) (por que cada provedor foi escolhido),
[CHANGELOG.md](../CHANGELOG.md) (histórico do porquê de cada mudança) e o
[README](../README.md) (como rodar localmente).

---

## 1. Arquitetura implementada

```text
                          ┌─────────────────────────────────────┐
   Analista               │  GitHub  ·  Joao19921/Piv-          │
      │                   │                                     │
      │ HTTPS             │  push/PR ──► CI (4 jobs)            │
      ▼                   │      build · test · security        │
┌──────────────┐          │                   │                 │
│   Render     │◄─────────┼── deploy hook ────┘                 │
│  Free Web    │          │   (só se os 3 passarem)             │
│  Service     │          └─────────────────────────────────────┘
│              │
│ ┌──────────┐ │  React 19 + Vite (estático, servido pelo mesmo processo)
│ │  SPA     │ │
│ └────┬─────┘ │
│      │       │
│ ┌────▼─────┐ │  Express · /api/v1/*
│ │  API     │ │  helmet → trust proxy → attachUser → requireAuth → requirePermission
│ └────┬─────┘ │
└──────┼───────┘
       │
       ├──────────────► Postgres (Supabase, sa-east-1) ── pooler Supavisor :5432
       │                 16 tabelas · RLS ligado sem policies
       │
       ├──────────────► BACEN PTAX  (ao vivo, sem chave)
       ├──────────────► Azure Retail Prices (ao vivo, sem chave)
       └──────────────► PNCP (ao vivo, sem chave — só prova de vida)

              ┌────────────────────────────────────────────┐
              │  AWS · conta pessoal do time · us-east-1   │
              │                                            │
   EventBridge│  cron(0 6 1,6,11,16,21,26 * ? *)  ~5 dias  │
   Rule ──────┼──► Lambda pivo-refresh-sources             │
              │      IAM Role: pricing:GetProducts apenas  │
              │      ├──► AWS Pricing API                  │
              │      ├──► GCP Billing API (API key)        │
              │      └──► grava no mesmo Postgres :6543    │
              └────────────────────────────────────────────┘

   Observabilidade: Sentry (erros) · UptimeRobot (uptime) · cron-job.org (keep-alive Supabase)
```

### Camadas do backend

`server/src/` segue Clean Architecture:

| Camada | Responsabilidade | Exemplos |
| :--- | :--- | :--- |
| `domain/services` | Regra de negócio pura, sem I/O | `pricingEngine`, `laborPricing`, `passwordPolicy`, `authorization` |
| `infrastructure` | I/O: banco, coletores externos, auth, observabilidade | `db/client`, `collectors/*`, `auth/*`, `repositories/*` |
| `presentation` | HTTP: rotas, middlewares, serialização | `app.ts`, `authRoutes`, `adminUsersRoutes`, `securityHeaders` |

### Cadeia de middlewares (ordem importa)

```
helmet + CSP report-only  →  trust proxy  →  express.json
  →  /healthz          (público, sem sessão)
  →  createAuthRouter  (login/logout/session — público por definição)
  →  requireAuth       (daqui pra baixo exige sessão ativa e sem troca de senha pendente)
  →  requirePermission("INFRA" | "LABOR" | "LICENSES")   por módulo
  →  requireRole("ADMIN")                                 em /admin/*
  →  handler de erro global (JSON + Sentry)
```

### Resiliência (três níveis)

Toda fonte externa passa por `executeWithFallback`:

1. **Primário** — chamada ao vivo, com retry e *circuit breaker* (abre após 2 falhas, meio-abre em 30s).
2. **Cache** — último valor bom em disco (`data/cache/`, efêmero no Render).
3. **Snapshot estático** — tabela embutida no código.

A UI **sempre** mostra qual nível respondeu (`OPERATIONAL` / `DEGRADED` / `FALLBACK_STALE` / `OFFLINE`).
Isso é intencional: o produto estima preço para contratação pública, onde a origem do dado
importa tanto quanto o número.

---

## 2. Stack da solução

Tudo o que o Pivô usa, e **por que** — não só a lista.

### Linguagem e runtime

| Item | Versão | Onde é declarado |
| :--- | :--- | :--- |
| Node.js | 22 LTS | `.nvmrc` (fonte única), `ARG NODE_VERSION` no Dockerfile, `--target=node22` em `build:lambda` |
| TypeScript | 5.6.3 (pinado, sem `^`) | `tsconfig.json` com `target: ES2022`, `strict: true` |
| pnpm | 10.4.1 | `packageManager` — o CI lê daqui via `pnpm/action-setup` |

> **Bump de major do Node é manual e deliberado.** A versão vive em três lugares que precisam
> andar juntos; um PR que mexa só no Dockerfile faria o CI testar num runtime e o Render publicar
> noutro. O `dependabot.yml` ignora major do Node por isso.

### Frontend

| Camada | Escolha | Nota |
| :--- | :--- | :--- |
| UI | React 19 + TypeScript | — |
| Build | Vite 8 | Bundle final ~540 kB (gzip ~156 kB) |
| Roteamento | `wouter` | Com patch local em `patches/wouter@3.7.1.patch` |
| Estado de servidor | TanStack Query 5 | Cache e invalidação das chamadas à API |
| Estilo | Tailwind CSS 4 + `tailwind-merge` + `tailwindcss-animate` | — |
| Componentes | shadcn/ui sobre Radix UI (26 pacotes) | Ver a ressalva abaixo |
| Formulários | React Hook Form + `@hookform/resolvers` + Zod | — |
| Animação | Framer Motion 13 | — |
| Ícones | `lucide-react` | — |
| Toasts | `sonner` | — |
| Tema | `next-themes` | Dark mode alternável |

> **Ressalva:** mais de 40 componentes em `client/src/components/ui/` **não são usados** por
> nenhuma tela — o kit shadcn foi adicionado inteiro de uma vez. Eles arrastam dependências
> (`embla-carousel-react`, `cmdk`, `vaul`, `input-otp`) que geram PR de atualização
> indefinidamente e ampliam a superfície. Três já foram removidos por terem quebrado o build ou
> carregado vulnerabilidade: `resizable`, `chart` (recharts) e `calendar` (react-day-picker).
> Ver pendência 11.

### Backend

| Camada | Escolha | Nota |
| :--- | :--- | :--- |
| HTTP | Express 4 | `express-async-errors` para rejeição em rota async cair no handler global |
| Banco | `pg` (driver nativo, sem ORM) | Queries SQL explícitas, com nome, para observabilidade por consulta |
| Segurança | `helmet` + `express-rate-limit` | Ver seção 4 |
| Validação | Zod (no cliente) / `typeof` manual (nas rotas) | Inconsistência conhecida — pendência 5 |
| Observabilidade | `@sentry/node` | Todo `logger.error()` vai para o Sentry quando `SENTRY_DSN` existe |
| Preços AWS | `@aws-sdk/client-pricing` | Só na Lambda; autentica por IAM Role, sem access key |
| Build | esbuild | `--packages=external`, então o runtime precisa do `node_modules` de produção |

Arquitetura em camadas (Clean Architecture) — `domain` não importa `infrastructure`:

```
server/
├── index.ts                    bootstrap: trust proxy → helmet → rotas → handler de erro
├── src/
│   ├── domain/services/        regra pura, sem I/O
│   │                           pricingEngine · laborPricing · laborBenchmark
│   │                           passwordPolicy · authorization · catalogs
│   ├── infrastructure/
│   │   ├── db/                 pool pg, transações, TLS condicional
│   │   ├── collectors/         aws · azure · gcp · bacen · pncp · caged
│   │   ├── repositories/       uma por agregado
│   │   ├── auth/               password (scrypt) · session (HMAC) · loginThrottle
│   │   ├── resilience/         circuit breaker + retry + fallback
│   │   └── observability/      logger · sentry · queryStats
│   └── presentation/           app.ts · authRoutes · adminUsersRoutes · securityHeaders
├── db/migrations/              9 arquivos .sql, aplicados por pnpm run migrate
├── scripts/                    migrate · seedAdmin · refreshSources · ingestCaged
├── lambda/                     handler da ingestão de preços
└── tests/                      vitest + supertest
```

### Dados e fontes

| Fonte | Acesso | Estado | Cadência |
| :--- | :--- | :--- | :--- |
| **CAGED / MTE** | FTP anônimo (`.7z`, ~53 MB/mês) | **Ao vivo** — salário CLT por CBO/UF | Mensal, GitHub Actions |
| BACEN PTAX | REST, sem chave | Ao vivo | Por requisição |
| Azure Retail Prices | REST, sem chave | Ao vivo | Por requisição |
| AWS Pricing API | SDK, IAM Role | Ingestão | ~5 dias, Lambda |
| GCP Cloud Billing | REST, API key | Ingestão | ~5 dias, Lambda |
| PNCP | REST, sem chave | Só prova de vida | Por requisição |
| **SISP / MGI** | Portarias SGD/MGI (valores em `catalogs.ts`) | **Fonte oficial** — referência publicada por cargo e senioridade | A cada Portaria nova |
| Catálogo de licenças | Hardcoded | Estimativa | — |

### Infraestrutura

| Função | Provedor | Plano | Nota |
| :--- | :--- | :--- | :--- |
| App web | Render | Free | Docker, hiberna sem uso |
| Banco | Supabase (Postgres 17) | Free | `sa-east-1`, via pooler Supavisor |
| Ingestão de preços | AWS Lambda + EventBridge | On-demand | Conta **pessoal** do time — pendência 8 |
| Ingestão do CAGED | GitHub Actions | Free | `7z` e `curl` já no runner |
| CI/CD | GitHub Actions | Free | 4 jobs, deploy só se os 3 passarem |
| Erros | Sentry | Free | `agentanalisedegoverno.sentry.io` |
| Uptime | UptimeRobot | Free | Monitora `/api/v1/healthz` |
| Keep-alive | cron-job.org | Free | Evita a Supabase pausar por inatividade |

**Custo fixo de infraestrutura: zero.** Todo o stack roda em plano gratuito — o que também
explica as limitações aceitas (hibernação do Render, pausa da Supabase, sem SLA).

### Ferramental de desenvolvimento

`vitest` + `supertest` (testes) · `prettier` (formatação) · `tsx` (executar TS direto) ·
`concurrently` (subir API e web juntos) · `cross-env` · `esbuild` · `postcss` + `autoprefixer` ·
`gitleaks` (segredos, no CI) · `pnpm audit` (dependências, no CI) · Dependabot (atualização).

---

## 3. Banco de dados

16 tabelas, 9 migrations. Schema versionado em [`server/db/migrations/`](../server/db/migrations/).

| Domínio | Tabelas |
| :--- | :--- |
| Catálogo cloud | `cloud_skus`, `cloud_regions`, `cloud_prices`, `storage_prices` |
| Arquiteturas salvas | `cloud_architectures`, `architecture_services` |
| Câmbio | `fx_rates` |
| Benchmark salarial | `market_benchmark_searches`, `market_benchmark_sources`, `salary_observations` (+ view `salary_benchmark_current`) |
| RBAC | `users`, `permissions`, `user_permissions` |
| Auditoria | `audit_logs` |
| Observabilidade | `ingestion_runs` |
| Controle do runner | `schema_migrations` |

**Todas com RLS habilitado e sem policies** — bloqueia acesso via PostgREST/anon key. O backend
conecta por connection string direta e não passa por RLS.

**`cloud_prices` e `fx_rates` são insert-only**: cada ingestão grava linha nova, e a leitura de
"preço atual" usa `distinct on (...) order by captured_at desc`. Isso preserva a série histórica.

### Aplicar migrations

```bash
pnpm run migrate                # aplica as pendentes
pnpm run migrate -- --dry-run   # lista sem executar
pnpm run migrate -- --baseline  # marca como aplicadas SEM executar (banco que já tem o schema)
```

Migration aplicada é **imutável**: o runner compara checksum e recusa arquivo alterado. Para
corrigir, crie um arquivo novo.

**Em produção isso é automático desde 2026-09-09**: o job `deploy` do CI aplica as pendentes
antes de disparar o deploy do Render, e falha na aplicação aborta o deploy. Rodar `pnpm run
migrate` na mão contra a Supabase só é necessário fora do fluxo normal (hotfix, ou primeira
adoção do runner num banco novo).

> **Contrato que isso impõe: migration precisa ser compatível com a versão ANTERIOR do código.**
> Ela roda enquanto a versão antiga ainda está servindo — o build do Render leva minutos. Na
> prática: `add column` com default ou nulo, sim; `drop column`, `rename` ou `not null` sem
> default exigem duas etapas (expand/contract) em deploys separados. Ignorar isso derruba a
> versão em produção no intervalo entre a migration e a publicação.

> **Porta do pooler muda conforme o consumidor.** Render (processo longo, pool persistente):
> `5432` (modo Session). Lambda (uma invocação por vez): `6543` (modo Transaction). E use
> **sempre** o pooler `aws-0-sa-east-1.pooler.supabase.com` — o host direto
> `db.<projeto>.supabase.co` só resolve em IPv6, e Render/Lambda só têm saída IPv4
> (`getaddrinfo ENOTFOUND`).

---

## 4. Segurança implementada

| Controle | Onde | Detalhe |
| :--- | :--- | :--- |
| Hash de senha | `auth/password.ts` | scrypt + salt aleatório, verificação com `timingSafeEqual` |
| Sessão | `auth/session.ts` | HMAC-SHA256, cookie `httpOnly` + `secure` + `sameSite=lax`, comparação constant-time |
| Política de senha | `domain/services/passwordPolicy.ts` | mín. 10 chars, letra + número/símbolo, variedade, bloqueio de senha óbvia e de senha derivada do nome/e-mail |
| Rate limit por IP | `authRoutes.ts` | 100 tentativas / 15 min (alto de propósito — NAT de escritório) |
| Bloqueio de conta | `auth/loginThrottle.ts` | 5 falhas → 15 min; **nem a senha correta passa** |
| Anti-enumeração | `loginThrottle` + `GENERIC_LOGIN_ERROR` | contagem por e-mail existindo a conta ou não; mesma mensagem para senha errada, conta inexistente e conta inativa |
| Cabeçalhos | `presentation/securityHeaders.ts` | helmet: HSTS (só em prod), nosniff, anti-clickjacking, sem `x-powered-by` |
| CSP | idem | **report-only** — ver pendência 3 |
| RBAC | `authMiddleware.ts` | gate no servidor, não só no menu; `INACTIVE` tratado como não autenticado mesmo com cookie válido |
| Isolamento de histórico | migration `0007` | benchmark filtrado por `user_id`; nem ADMIN vê o dos outros |
| Auditoria | `repositories/auditRepository.ts` | login (ok/negado/bloqueado/inativo), troca de senha, CRUD de usuário |
| Segredos | CI (`gitleaks`) | varredura a cada push, com allowlist por valor em `.gitleaks.toml` |
| Dependências | CI (`pnpm audit --prod`) | gate quebra o build; passivo declarado em `pnpm.auditConfig` |
| TLS do banco | `db/client.ts` | `DATABASE_CA_CERT` ativa verificação de identidade do servidor |

### Regras não negociáveis

- **Auditoria nunca derruba a operação auditada.** Falha de gravação vai para o log/Sentry; o
  login continua. Auditoria que quebra funcionalidade vira incentivo para desligarem a auditoria.
- **`audit_logs.metadata` nunca recebe segredo.** Sem senha, sem hash, sem cookie.
- **Nunca apontar `DATABASE_URL` de teste para a Supabase.** A suíte apaga linhas no teardown.

---

## 5. Operação do dia a dia

### Criar o primeiro ADMIN

```bash
ADMIN_NAME="..." ADMIN_EMAIL="..." ADMIN_INITIAL_PASSWORD="..." pnpm run seed:admin
```
Defina as variáveis só no momento de rodar e apague em seguida — a senha inicial não deve ficar
guardada em lugar nenhum.

### Rodar a ingestão de preços na mão

```bash
pnpm run refresh-sources          # local, usando sua sessão AWS (aws configure/sso)
aws lambda invoke --function-name pivo-refresh-sources --region us-east-1 out.json
```

### Publicar a Lambda

```bash
pnpm run build:lambda
powershell -File scripts/deploy-lambda.ps1
```

### Rodar a ingestão do CAGED

Lote **mensal**, no GitHub Actions (não na Lambda — ver `cagedCollector.ts` para o porquê).

```bash
# Na mão, pela CLI:
gh workflow run ingest-caged.yml -f dry_run=true          # só calcula e imprime
gh workflow run ingest-caged.yml                           # grava no banco
gh workflow run ingest-caged.yml -f competencia=202606     # competência específica

# Localmente (exige curl e 7z no PATH):
pnpm run ingest:caged -- --dry-run
```

Agendado para todo dia 5 às 09:00 UTC. O MTE publica com ~1 mês de defasagem, sempre na virada
do mês; se o arquivo ainda não estiver lá, o job reprocessa a competência anterior, que é
idempotente (`on conflict do update` por competência).

**O `dry_run` não exige `DATABASE_URL`** — de propósito: conferir os números do CAGED antes de
configurar qualquer secret é justamente o uso mais útil dele.

Como saber se o resultado está bom: a hierarquia salarial tem que fazer sentido (suporte <
programador < desenvolvimento < DBA < gerência). Foi exatamente uma quebra dessa hierarquia que
denunciou um mapa de CBO errado na primeira execução — ver CHANGELOG de 2026-09-09.

### Rodar a ingestão do SISP

Não é coleta externa: materializa em `salary_observations` os valores das Portarias SGD/MGI que
vivem em `catalogs.ts`, com proveniência (link da Portaria + data).

```bash
pnpm run ingest:sisp -- --dry-run   # só lista
pnpm run ingest:sisp                # grava
```

Rode **depois de editar `catalogs.ts`** quando sair Portaria nova. O script falha alto se
encontrar Portaria sem URL oficial mapeada em `FONTE_POR_PORTARIA` — em vez de gravar com
proveniência inventada. Nesse caso, acrescente a URL da página do modelo no gov.br (a página do
modelo, não o PDF: o PDF muda de nome a cada republicação).

### Ativar verificação de certificado do Postgres

> **Atenção — isto já derrubou a produção (10/09/2026).** O certificado que a Supabase
> disponibiliza para download valida a **conexão direta**, não o **pooler Supavisor**, que é o
> que o app usa. Configurar `DATABASE_CA_CERT` com ele faz o handshake falhar com
> `self-signed certificate in certificate chain`, e **toda** consulta passa a dar erro: o app
> sobe, mas login e qualquer tela com dados respondem 500.
>
> Ligar essa variável transforma uma proteção opcional em ponto único de falha. Remover a
> variável restaura a conexão na hora.

Procedimento seguro:

1. Obtenha o CA correspondente ao host que o app realmente usa — o do **pooler**, não o da
   conexão direta. Se a Supabase não publicar um para o pooler, esta variável não é aplicável.
2. **Valide localmente antes**, com a mesma connection string de produção, e só siga se o
   resultado for `{ status: 'ok' }`:

```bash
DATABASE_CA_CERT="$(cat prod-ca.crt)" node --experimental-strip-types -e "
  require('dotenv/config');
  const { pingDatabase } = await import('./server/src/infrastructure/db/client.ts');
  console.log(await pingDatabase());
"
```

3. Só então cadastre no Render, e confirme em `/api/v1/healthz` que `db.status` segue `ok`.

Se quebrar, o `reason` em `/healthz` aponta a variável culpada, não só o erro de TLS.

O certificado **não** é versionado de propósito: o CA é rotacionado, e um `.crt` commitado vira
bomba-relógio que derruba produção no dia da troca.

---

## 6. Diagnóstico de incidentes

### "Todo mundo foi deslogado depois do deploy"

**Causa quase certa:** `SESSION_SECRET` não está configurada no Render. Sem ela o app gera um
segredo efêmero **a cada boot**, invalidando todos os cookies.

**Confirmar:** procure no log do Render por
`SESSION_SECRET nao configurada; usando segredo efemero`.

**Corrigir:** gerar com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
e cadastrar no painel. Ao salvar, as sessões caem uma última vez; das próximas em diante sobrevivem.

### "Usuário não consegue entrar, diz que teve muitas tentativas"

Bloqueio de conta após 5 falhas, por 15 minutos. **É temporário e expira sozinho.** Para confirmar
que é bloqueio e não senha errada, consulte a trilha:

```sql
select action, metadata, created_at
  from audit_logs
 where action in ('LOGIN_FAILED','LOGIN_BLOCKED')
 order by created_at desc limit 20;
```

Para destravar antes do prazo, um ADMIN pode desativar e reativar o usuário, ou:

```sql
update users set failed_login_attempts = 0, locked_until = null where email = '...';
```

> O contador em memória também precisa zerar. Ele expira em 15 min sozinho; um restart do
> serviço também limpa.

### "O login parou" / "toda tela dá erro, mas o app abre"

**Primeira coisa a olhar**, porque distingue as duas causas em uma chamada:

```bash
curl -s https://pivo-i8m3.onrender.com/api/v1/healthz
```

- `"db":{"status":"ok"}` — o banco responde; o problema é outro.
- `"db":{"status":"unreachable", "reason": "..."}` — **é isto**. A aplicação subiu mas não fala
  com o Postgres. Toda rota que consulta responde 500 (login inclusive), enquanto as que não
  consultam seguem normais — foi exatamente esse o padrão do incidente de 10/09/2026.

Confirmando pelo comportamento das rotas:

| Rota | Toca banco? | Se o banco caiu |
| :--- | :--- | :--- |
| `GET /auth/session` sem cookie | não | 200 |
| `POST /auth/login` sem campos | não | 400 |
| `POST /auth/login` com campos | **sim** | **500** |

**Onde investigar**, em ordem: `DATABASE_CA_CERT` no Render (se preenchida com PEM errado ou
incompleto, o TLS passa a exigir verificação contra um CA inválido e *toda* consulta falha);
`DATABASE_SSL` (se estiver `disable`, o pooler da Supabase recusa a conexão); `DATABASE_URL`
(host/porta/senha). O log do Render traz a linha `Consulta '...' falhou` com a mensagem do driver.

Para separar app de banco, conecte direto com a mesma connection string — se o `psql`/driver
conecta e o app não, a diferença está nas variáveis do Render, não no Postgres.

### "A API responde 500"

O handler global registra tudo no Sentry (`agentanalisedegoverno.sentry.io`, projeto `pivo`).
O usuário recebe mensagem genérica de propósito — detalhe técnico não vai para a tela.

### "Uma fonte de preço está fora"

Não é incidente: o sistema degrada por desenho. Veja `/system-health` na UI ou:

```sql
select service_name, status, records_upserted, error_message, finished_at
  from ingestion_runs order by finished_at desc limit 20;
```

### "O app está lento na primeira requisição"

Render Free hiberna após inatividade. O UptimeRobot mantém o serviço acordado; o cron-job.org
mantém o Supabase ativo (o projeto free pausa após ~1 semana sem atividade).

### "O deploy passou mas a versão antiga continua no ar"

O smoke test do CI compara o commit em `/api/v1/healthz` com o `github.sha`. Se ele passou,
a versão subiu. Se falhou por timeout, o build do Render quebrou — veja o painel do Render.

---

## 7. Pendências conhecidas

Ordenadas por risco. Cada uma tem causa e caminho de saída registrados.

| # | Pendência | Impacto | Caminho |
| :--- | :--- | :--- | :--- |
| 1 | **Auto-Deploy do Render possivelmente ligado** | Se estiver, o Render publica a cada push sem esperar o CI, e o gate vira alarme depois do fato | Render → Settings → Build & Deploy → Auto-Deploy: `No` |
| 2 | **CSP em report-only** | Não bloqueia XSS ainda, só relata | Revisar violações e trocar `reportOnly: false` em `securityHeaders.ts` |
| 3 | **`DATABASE_CA_CERT` inaplicável hoje** | Conexão cifrada mas sem verificar identidade do servidor. Configurá-la com o CA da conexão direta **derruba a produção** (incidente de 10/09/2026): o pooler Supavisor apresenta outra cadeia | Obter um CA válido para o pooler; sem isso, manter desligada — ver Seção 5 |
| 4 | **Validação de rota feita à mão** com `typeof` | `zod` já é dependência e é usado no cliente; validação manual é fácil de esquecer num campo novo | Migrar rotas para schemas zod |
| 5 | **Sem checagem de senha vazada** | Política bloqueia senha óbvia, mas não senha real que já vazou | Integrar HaveIBeenPwned (range API, k-anonymity) |
| 6 | **Sem retenção/anonimização** de `market_benchmark_searches.notes` | Campo livre onde se cola nome de cliente; LGPD | Definir política de retenção e job de expurgo |
| 7 | **Deploy da Lambda é manual**, de máquina de dev, sem IaC | Sem revisão, sem estado, sem drift detection | Terraform/SAM + job no CI |
| 8 | **Sem teste no cliente** (0 arquivos) | Regressão de UI só aparece em produção | Vitest + Testing Library |
| 9 | **A suíte depende de APIs externas ao vivo** | Testes que batem em `/system-health` chamam BACEN/Azure/PNCP de verdade; latência do runner já quebrou o build sem nada errado no código | Injetar/stubar os coletores; hoje mitigado só com `testTimeout: 30s` |
| 10 | **40+ componentes shadcn órfãos** em `client/src/components/ui/` | Arrastam dependências (embla-carousel, cmdk, vaul, input-otp…) que geram PR de atualização indefinidamente e ampliam superfície | Remover os não usados — já feito para `resizable`, `chart` e `calendar` |
| 11 | **`pnpm` declarado duas vezes com versões divergentes** | devDependency `^10.15.1` vs `packageManager` `10.4.1` — duas fontes de verdade para a mesma ferramenta, já discordando entre si | Remover a devDependency e deixar só `packageManager` + corepack (exige corepack disponível nas máquinas do time) |
| 12 | **Portaria de infraestrutura pode estar superada** | A SGD/MGI nº 5.921/2026 atualizou a nº 1.070/2023; o catálogo ainda usa os valores da nº 6.055/2025 | Conferir o anexo novo e atualizar `catalogs.ts`, depois `pnpm run ingest:sisp` |
| 13 | **1 vulnerabilidade high aceita** (`path-to-regexp` via express 4) | Exige rota com padrão dinâmico controlado pelo atacante; todas as rotas são estáticas | Migrar para express 5 |
| 14 | **Secret `BENCHMARK_WORKER_DATABASE_URL` ausente no GitHub** | O worker Python (`benchmark-worker/`) não roda: `run` (agendado a cada ~10 dias) e `manual-entry` via Actions falham cedo com erro explícito, de propósito. A tela do admin em `/administracao/benchmark-worker` **não depende disso** — usa o `DATABASE_URL` da própria aplicação | Criar uma connection string própria do worker (privilégio mínimo, só tabelas `benchmark_*`) e configurar como Secret — ver docs/BENCHMARK-WORKER-MANUAL.md, seção 4 |

### Resolvidas nesta frente de trabalho

Mantidas aqui porque o **motivo** de cada uma continua valendo como referência — a maioria só
apareceu depois de causar dano real.

| O que era | Como fechou |
| :--- | :--- |
| **Migration em produção era passo manual** — as `0007`, `0008` e `0009` ficaram pendentes com o código já no ar, e o app degradou em silêncio porque os caminhos afetados são defensivos | O job `deploy` aplica as pendentes antes de publicar; falha aborta o deploy |
| **Secret `DATABASE_URL` ausente no GitHub** — a ingestão mensal não tinha onde gravar | Configurado; ingestão gravando |
| **`catalogs.ts` usava `cbo` como agrupamento, não como CBO** — `2124-05` carregava dez cargos distintos; o join do CAGED daria salário de desenvolvedor ao designer de UX | 66 dos 73 perfis com o CBO corrigido contra a classificação oficial; os 36 cargos que a CBO 2002 não prevê ficaram com `cbo: null`, sem código inventado |
| **CAGED nunca havia sido ingerido** — o catálogo declarava `benchmarkSource: "CAGED/MTE"` sobre números que nunca vieram do CAGED | Pipeline mensal em produção: 4,4 M linhas processadas, 84 observações da competência 2026-07 gravadas e servidas em `/labor/profiles` |
| **Sem branch protection** exigindo os checks do CI — já aconteceu: o merge do PR #7 quebrou o `master` | Resolvido em 2026-09-11: `master` ganhou os mesmos checks obrigatórios (`Typecheck + build`, `Testes automatizados`, `Segurança`), `enforce_admins` e bloqueio de force-push/deleção que uma tentativa anterior (incompleta) de migrar o deploy para uma branch `main` havia configurado só lá. A branch `main` — nunca observada pelo Render, órfã desde essa tentativa — foi removida junto com o PR aberto contra ela (#20), que não trazia nada que `master` já não tivesse |

## 8. Enriquecimento de dados: o que foi feito e o que falta

Decisão registrada: **não** haverá scraping de Glassdoor/Indeed. Os termos de uso proíbem, a
proposta original previa contornar CAPTCHA com sessão persistida (burla de controle de acesso), e
— o que mais pesa aqui — o Pivô estima custo para **contratação pública**, onde a fonte precisa
ser citável num processo. "Raspagem não autorizada" não sustenta estimativa diante de TCU/CGU.

Vale registrar que a **intuição arquitetural da proposta original estava certa**: cron → worker
de timeout longo → Postgres é exatamente a forma. O que mudou foi a fonte — arquivo oficial do
governo no lugar de raspagem autenticada. Mesma infra, sem o passivo jurídico.

### Entregue

| Fonte | O que dá | Estado |
| :--- | :--- | :--- |
| **Novo CAGED (PDET/MTE)** | Salário **CLT** por CBO e UF, com P25/mediana/P75 e n amostral | **Em produção.** Validado na competência 202607: 4,4 M linhas, 14.405 admissões de TI, 81 recortes |
| **SISP / Portarias SGD/MGI** | Referência **oficial** por cargo e senioridade — 68 perfis | **Em produção.** Aparece como `referenciaOficial`, ao lado do valor de mercado, não no lugar dele |

Como o dado chega à tela:

```
FTP do PDET ──► GitHub Actions (mensal) ──► salary_observations ──► laborBenchmark.ts ──► /labor/profiles
   .7z 53 MB      7z + parse streaming        1 linha/competência      junta com catalogs.ts
```

Duas regras que governam a junção, e não são negociáveis:

1. **Só perfil CLT recebe dado do CAGED.** O CAGED é o cadastro de emprego formal — por
   definição, vínculo celetista. Aplicar a mediana dele num perfil PJ misturaria duas coisas que
   o mercado precifica de formas diferentes.
2. **Perfil sem CBO não recebe nada.** A CBO 2002 não tem ocupação para Cientista de Dados,
   Engenheiro de IA, UX/UI nem Scrum Master. Esses ficam com `cbo: null` e seguem exibindo a
   estimativa, rotulada como tal — inventar um código "próximo" produziria número plausível e
   infundado, pior que ausência de número.

**Senioridade é lida como faixa da distribuição.** O CAGED agrega por CBO, e CBO não distingue
nível — é um código só, do júnior ao sênior. Em vez de exibir a mesma mediana nos três níveis (ou
inventar um multiplicador), cada senioridade recebe um ponto da distribuição observada: **P25 →
Júnior, mediana → Pleno, P75 → Sênior**. "Especialista" cai no P75 junto com "Sênior" porque a
amostra não oferece ponto acima; o rótulo diz qual percentil sustentou o valor, então a limitação
fica visível.

Hoje, dos 73 perfis do catálogo: **35 são elegíveis** ao CAGED (CLT e com CBO), distribuídos em
13 CBOs distintos; 36 estão sem CBO porque a CBO 2002 não prevê a ocupação, e 3 são PJ. Quantos
desses 35 de fato exibem dado observado depende de a última ingestão ter atingido a amostra
mínima naquele CBO — a resposta de `/labor/profiles` traz `coverage` com a contagem real do
momento, em vez de um número fixo escrito aqui.

### PNCP: avaliado e descartado como fonte de benchmark

A intenção era usá-lo para o lado PJ — quanto o setor público efetivamente paga por posto/hora de
TI. A sondagem contra a API real derrubou a ideia, e vale registrar o porquê para não se repetir
o esforço:

| Achado | Medida |
| :--- | :--- |
| Densidade baixíssima | 0,63% das contratações são TI **e** mão de obra. Achá-las exige varrer 99.582 pregões + 175.262 dispensas por trimestre |
| A API bloqueia | Após algumas centenas de chamadas, timeout puro. Confirmado que não era rede: site do PNCP 302, BACEN 200, GitHub 200 — só a API em timeout |
| Unidade não padronizada | `UND SERVIÇO T`, não `POSTO`/`HORA`/`UST`. Sem normalizar, os valores não se comparam |
| Descrição não identifica o cargo | "Serviços de Consultoria em TI" não diz se é júnior ou arquiteto sênior |

Reabrir só faria sentido se o PNCP passar a oferecer filtro por objeto/categoria na consulta, ou
um dump em lote. O código de sondagem não foi mantido no repositório — refazê-lo é meia hora.

### Próximos, em ordem de valor

| Fonte | Ganho | Trabalho envolvido |
| :--- | :--- | :--- |
| Tabelas SGD/MGI (SISP) | Já no catálogo, mas hardcoded | Automatizar a leitura das Portarias |
| IBGE / SIDRA (PNAD) | Recorte por ocupação e região; cobriria parte dos cargos sem CBO | API pública, não sondada ainda |
| Convenções coletivas (Mediador/MTE) | Piso legal por sindicato e UF — frequentemente o argumento decisivo numa negociação | — |
| RAIS (anual) | Base muito maior que o CAGED mensal; permitiria recorte por **município** | Mesmo FTP, arquivo bem maior |

O hook `MARKET_BENCHMARK_CONNECTOR_URL` continua escrito em `marketBenchmark.ts` e nunca foi
ligado — é o ponto de entrada natural para a busca livre por cargo/UF/cidade, quando ela existir.

---

## 9. Contatos e acessos

| Recurso | Onde | Quem tem acesso |
| :--- | :--- | :--- |
| Repositório | `github.com/Joao19921/Piv-` | — |
| Produção | `https://pivo-i8m3.onrender.com` | — |
| Render | painel do serviço `pivo` | só quem tem a conta |
| Supabase | projeto `pivo` (sa-east-1) | idem |
| AWS | conta **pessoal** do time, us-east-1 | idem — ver pendência 8 |
| Sentry | `agentanalisedegoverno.sentry.io`, projeto `pivo` | — |
| UptimeRobot | monitor de `/api/v1/healthz` | — |
| cron-job.org | keep-alive do Supabase, 1x/dia | — |

> **Atenção ao recriar o monitor de uptime:** `pivo.onrender.com` (sem sufixo) **não é** este
> serviço — é um app de terceiro que registrou o nome antes. A URL real tem o sufixo `-i8m3`.
