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
       │                 15 tabelas · RLS ligado sem policies
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

## 2. Banco de dados

15 tabelas, 8 migrations. Schema versionado em [`server/db/migrations/`](../server/db/migrations/).

| Domínio | Tabelas |
| :--- | :--- |
| Catálogo cloud | `cloud_skus`, `cloud_regions`, `cloud_prices`, `storage_prices` |
| Arquiteturas salvas | `cloud_architectures`, `architecture_services` |
| Câmbio | `fx_rates` |
| Benchmark salarial | `market_benchmark_searches`, `market_benchmark_sources` |
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

> **Porta do pooler muda conforme o consumidor.** Render (processo longo, pool persistente):
> `5432` (modo Session). Lambda (uma invocação por vez): `6543` (modo Transaction). E use
> **sempre** o pooler `aws-0-sa-east-1.pooler.supabase.com` — o host direto
> `db.<projeto>.supabase.co` só resolve em IPv6, e Render/Lambda só têm saída IPv4
> (`getaddrinfo ENOTFOUND`).

---

## 3. Segurança implementada

| Controle | Onde | Detalhe |
| :--- | :--- | :--- |
| Hash de senha | `auth/password.ts` | scrypt + salt aleatório, verificação com `timingSafeEqual` |
| Sessão | `auth/session.ts` | HMAC-SHA256, cookie `httpOnly` + `secure` + `sameSite=lax`, comparação constant-time |
| Política de senha | `domain/services/passwordPolicy.ts` | mín. 10 chars, letra + número/símbolo, variedade, bloqueio de senha óbvia e de senha derivada do nome/e-mail |
| Rate limit por IP | `authRoutes.ts` | 100 tentativas / 15 min (alto de propósito — NAT de escritório) |
| Bloqueio de conta | `auth/loginThrottle.ts` | 5 falhas → 15 min; **nem a senha correta passa** |
| Anti-enumeração | `loginThrottle` + `GENERIC_LOGIN_ERROR` | contagem por e-mail existindo a conta ou não; mesma mensagem para senha errada, conta inexistente e conta inativa |
| Cabeçalhos | `presentation/securityHeaders.ts` | helmet: HSTS (só em prod), nosniff, anti-clickjacking, sem `x-powered-by` |
| CSP | idem | **report-only** — ver pendência #2 |
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

## 4. Operação do dia a dia

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

### Ativar verificação de certificado do Postgres

1. Supabase Dashboard → Project Settings → Database → SSL Configuration → **Download certificate**.
2. Render → serviço `pivo` → Environment → nova variável `DATABASE_CA_CERT` com o conteúdo do
   `.crt` (pode colar com `\n` literais).
3. Save. A conexão passa a usar `rejectUnauthorized: true`.

O certificado **não** é versionado de propósito: o CA é rotacionado, e um `.crt` commitado vira
bomba-relógio que derruba produção no dia da troca.

---

## 5. Diagnóstico de incidentes

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

## 6. Pendências conhecidas

Ordenadas por risco. Cada uma tem causa e caminho de saída registrados.

| # | Pendência | Impacto | Caminho |
| :--- | :--- | :--- | :--- |
| 1 | **Sem branch protection** exigindo os checks do CI | PRs com CI vermelho podem ser mergeados — já aconteceu: o merge do PR #7 quebrou o `master` | Settings → Branches → require status checks `build`, `test`, `security` |
| 2 | **Auto-Deploy do Render possivelmente ligado** | Se estiver, o Render publica a cada push sem esperar o CI, e o gate vira alarme depois do fato | Render → Settings → Build & Deploy → Auto-Deploy: `No` |
| 3 | **CSP em report-only** | Não bloqueia XSS ainda, só relata | Revisar violações e trocar `reportOnly: false` em `securityHeaders.ts` |
| 4 | **`DATABASE_CA_CERT` não configurada** | Conexão com o banco é cifrada mas sem verificar identidade do servidor (MITM ativo) | Seção 4 acima |
| 5 | **Validação de rota feita à mão** com `typeof` | `zod` já é dependência e é usado no cliente; validação manual é fácil de esquecer num campo novo | Migrar rotas para schemas zod |
| 6 | **Sem checagem de senha vazada** | Política bloqueia senha óbvia, mas não senha real que já vazou | Integrar HaveIBeenPwned (range API, k-anonymity) |
| 7 | **Sem retenção/anonimização** de `market_benchmark_searches.notes` | Campo livre onde se cola nome de cliente; LGPD | Definir política de retenção e job de expurgo |
| 8 | **Deploy da Lambda é manual**, de máquina de dev, sem IaC | Sem revisão, sem estado, sem drift detection | Terraform/SAM + job no CI |
| 8b | **A suíte depende de internet de saída** | `/system-health` consulta BACEN/Azure/PNCP ao vivo; sem rede, esses testes ficam lentos e dependem do fallback. `testTimeout` está em 30s por isso | Isolar os coletores por injeção de dependência nos testes de rota |
| 9 | **Sem teste no cliente** (0 arquivos) | Regressão de UI só aparece em produção | Vitest + Testing Library |
| 10 | **1 vulnerabilidade high aceita** (`path-to-regexp` via express 4) | Exige rota com padrão dinâmico controlado pelo atacante; todas as rotas são estáticas | Migrar para express 5 |
| 10b | **40+ componentes shadcn órfãos** em `client/src/components/ui/` | Kit inteiro adicionado de uma vez; arrastam dependências (embla-carousel, cmdk, vaul, input-otp…) que geram PR de atualização indefinidamente e ampliam superfície | Decisão de produto: remover os não usados |
| 11 | **CAGED nunca foi ingerido de verdade** | O catálogo diz `benchmarkSource: "CAGED/MTE"` mas é snapshot estático | Fase 2 — ver abaixo |

---

## 7. Próxima fase: enriquecimento de dados

Decisão registrada: **não** haverá scraping de Glassdoor/Indeed. Os termos de uso proíbem, a
proposta original previa contornar CAPTCHA com sessão persistida (burla de controle de acesso), e
— o que mais pesa aqui — o Pivô estima custo para **contratação pública**, onde a fonte precisa
ser citável num processo. "Raspagem não autorizada" não sustenta estimativa diante de TCU/CGU.

O caminho aprovado reaproveita o que já existe (`ingestionOrchestrator` + Lambda + EventBridge +
`ingestion_runs` + `resilienceManager`), **sem** Docker/ECR/Playwright:

| Fonte | Ganho | Estado |
| :--- | :--- | :--- |
| Novo CAGED / RAIS (PDET-MTE) | Salário por CBO/UF/município — o formato exato de `laborProfiles` | Maior ganho isolado |
| PNCP (preços contratados) | Valor efetivamente pago em contratos públicos de TI; cliente HTTP já existe | Hoje só faz prova de vida |
| Tabelas SGD/MGI (SISP) | Já no catálogo, mas hardcoded | Automatizar leitura das Portarias |
| Salariômetro (Fipe) / PNAD (IBGE) | Recorte por ocupação e região | API pública |
| Convenções coletivas (Mediador/MTE) | Piso legal por sindicato/UF | — |

Schema proposto: `salary_observations` **append-only** (`source`, `cbo`, `uf`, `municipio`,
`employment_model`, `p25`, `mediana`, `p75`, `n_amostra`, `competencia`, `url_fonte`) +
view materializada `salary_benchmark_current`. Único em
`(source, cbo, uf, municipio, competencia, employment_model)`.

O hook `MARKET_BENCHMARK_CONNECTOR_URL` já está escrito em `marketBenchmark.ts` e nunca foi
ligado — é o ponto de entrada natural dessa camada.

---

## 8. Contatos e acessos

| Recurso | Onde | Quem tem acesso |
| :--- | :--- | :--- |
| Repositório | `github.com/Joao19921/Piv-` | — |
| Produção | `https://pivo-i8m3.onrender.com` | — |
| Render | painel do serviço `pivo` | só quem tem a conta |
| Supabase | projeto `pivo` (sa-east-1) | idem |
| AWS | conta **pessoal** do time, us-east-1 | idem — ver pendência #8 |
| Sentry | `agentanalisedegoverno.sentry.io`, projeto `pivo` | — |
| UptimeRobot | monitor de `/api/v1/healthz` | — |
| cron-job.org | keep-alive do Supabase, 1x/dia | — |

> **Atenção ao recriar o monitor de uptime:** `pivo.onrender.com` (sem sufixo) **não é** este
> serviço — é um app de terceiro que registrou o nome antes. A URL real tem o sufixo `-i8m3`.
