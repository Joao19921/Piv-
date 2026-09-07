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
- carrega o usuario da sessao (`attachUser`) sempre que `DATABASE_URL` esta configurado — sem banco nao ha usuarios possiveis, entao o gate fica desligado (mesmo comportamento de dev sem Postgres que ja existia antes do RBAC);
- dentro do router (`app.ts`), `/auth/session`, `/auth/login`, `/auth/logout` ficam acessiveis sem sessao (e o proprio ponto de entrada do login); todo o resto exige `requireAuth` (sessao valida + senha ja trocada), com `requirePermission`/`requireRole` adicionais por modulo (ver "Autorizacao (RBAC)" abaixo).

## Modulos De Codigo

### Frontend

```text
client/src/pages/Home.tsx
client/src/pages/cloud/CloudArchitect.tsx  # Cloud Architecture Calculator (builder multi-servico)
client/src/hooks/*
client/src/lib/api.ts
client/src/lib/csv.ts                     # Exportacao CSV (Licencas, Cloud Architect) — separador ";", compativel com Excel pt-BR
client/src/components/ui/*
```

Responsabilidades:

- renderizar os modulos de negocio;
- consultar a API com TanStack Query;
- expor estados de carregamento, erro, fallback e fonte;
- manter estado de UI local;
- navegar por rotas reais (wouter) — `SECTION_PATHS` em `App.tsx` mapeia cada modulo pra
  uma URL propria (`/`, `/mao-de-obra`, `/infra-cloud`, `/licencas`, `/fontes`), em vez de
  estado local: URL muda por modulo, botao Voltar do navegador e links compartilhaveis
  funcionam.

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
- manter catalogos de perfis, licencas, regioes, SKUs de compute e servicos cloud (Storage/Database/Networking/Containers/Serverless/CDN);
- calcular custo mensal de cada servico cloud (Pricing Engine, separado da UI e das rotas);
- estimar benchmark salarial por cargo, UF e cidade.

Arquivos principais:

- `laborPricing.ts`: custo mensal, custo/hora e taxa sugerida.
- `marketBenchmark.ts`: benchmark por cargo/regiao com historico.
- `cloudCatalog.ts`: providers, regioes e SKUs de compute (fonte de verdade para EC2/Azure VM/GCE, com preco ao vivo/ingestao).
- `cloudServiceCatalog.ts`: catalogo pesquisavel de servicos cloud alem de compute (Storage/Database/Networking/Containers/Serverless/CDN) — 21 entradas (AWS/Azure/GCP), cada uma com campos de configuracao (`configFields`) e uma formula pura de preco (usada como fallback/preco de catalogo). Compute nao tem formula aqui (delega para `pricingEngine.ts` -> `cloudCatalog.ts`). 4 servicos Azure (Storage, SQL, Load Balancer, Functions) tem preco ao vivo real via Azure Retail Prices API (a formula do catalogo so roda se a API falhar); os demais (todos GCP/AWS nao-compute) sao preco de catalogo (referencia publica, nao API ao vivo) — sempre com `pricingInfo.estimated`/`sourceUrl` explicitos.
- `pricingEngine.ts`: unico ponto que calcula preco de um servico (`calculateServicePrice(serviceId, region, config)`). Para Compute, delega ao pipeline ao vivo existente (`cloudCatalog.ts` + coletores). Para os 4 servicos Azure com preco ao vivo, chama `calculateAzureLiveServicePrice()` (Azure Retail Prices API, sem chave — mesmo motivo pelo qual so a Azure tem esse tratamento: GCP/AWS so falam ao vivo com a Lambda de ingestao, nunca por requisicao do app web, para nao expor credencial nem pagar o custo de paginar milhares de SKUs por request). Para os demais, aplica a formula do catalogo. Nao broadcasta ao vivo/estimado sem etiqueta — todo `ServicePricing` carrega `source`/`estimated`/`lastUpdated`/`sourceUrl`.
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
- `db/client.ts`: pool `pg` para o Postgres (Supabase), com observabilidade de consultas (duracao, erros) via `observability/queryStats.ts`. Exporta `withTransaction()` para operacoes que gravam mais de uma tabela atomicamente (BEGIN/COMMIT/ROLLBACK numa unica conexao).
- `repositories/`: `cloudPricingRepository`, `cloudArchitectureRepository` (arquiteturas + servicos, com `insertArchitecture`/`updateArchitecture` transacionais), `storagePricingRepository`, `fxRepository`, `marketBenchmarkRepository`, `ingestionRunsRepository` — leitura/escrita das tabelas descritas em "Banco De Dados" abaixo.
- `observability/logger.ts` e `observability/queryStats.ts`: logging estruturado (JSON por linha, capturado pelo log viewer do Render) e contadores em memoria por consulta.

## Autorizacao (RBAC)

Login por e-mail/senha, com perfil (`ADMIN`/`USER`) separado de permissoes por modulo (`LABOR`/`INFRA`/`LICENSES`) — evita criar um perfil por combinacao (`USER_LABOR_INFRA` etc.). ADMIN nunca ganha linhas de permissao: acesso total e derivado do `role`, nao duplicado.

- `infrastructure/auth/password.ts`: hash de senha com `crypto.scryptSync` (salt aleatorio + `timingSafeEqual` na comparacao) — extensao do mesmo modulo `crypto` ja usado pra assinar a sessao, sem dependencia nova (evita risco de binding nativo de bcrypt/argon2 quebrar no build Docker Alpine).
- `infrastructure/auth/session.ts`: cookie HMAC assinado carrega `userId` + expiracao; `SESSION_SECRET` (env var) e o segredo de assinatura — nunca a senha de ninguem. Sem essa variavel, gera um segredo efemero no boot (funciona, so nao sobrevive a um restart/redeploy) e loga um aviso.
- `domain/services/authorization.ts`: `hasPermission`/`isAdmin`, funcoes puras sem I/O — o que os testes unitarios exercitam direto.
- `infrastructure/repositories/userRepository.ts`: CRUD de usuario + permissoes (`insertUser`/`updateUser` transacionais via `withTransaction`, substituem as linhas de `user_permissions` por completo a cada save).
- `presentation/authMiddleware.ts`: `attachUser` (carrega `req.user` a partir do cookie; usuario `INACTIVE` e tratado como nao autenticado mesmo com cookie ainda valido — cobre desativacao no meio de uma sessao aberta), `requireAuth` (sessao valida **e** sem troca de senha pendente — 403 `password_change_required` senao), `requireSession` (so sessao valida, usado pela propria rota de troca de senha pra nao virar um cadeado sem chave), `requirePermission(code)`, `requireRole("ADMIN")`.
- `presentation/authRoutes.ts` + `presentation/adminUsersRoutes.ts`: rotas de sessao (login/logout/troca de senha) e CRUD administrativo de usuarios (ver "API Publica" abaixo). Sem exclusao fisica na V1 — so ativar/desativar.
- `scripts/seedAdmin.ts` (`pnpm run seed:admin`): cria o primeiro ADMIN a partir de env vars fornecidas na hora (nunca inventa senha) — ver README.

**Reforço real, nao so esconder menu**: toda checagem vive no backend. O frontend (`Home.tsx`) filtra o menu lateral e bloqueia a renderizacao de uma secao sem permissao (`NoAccess`), mas isso e so UX — a API recusa (401/403) mesmo que alguem chame a rota direto.

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

## Qualidade E Resiliencia Das Consultas Ao Postgres

Decisoes tomadas numa revisao dedicada das consultas ao banco (detalhe completo em `CHANGELOG.md`):

- **TLS sem verificacao de certificado, deliberadamente**: `db/client.ts` usa `ssl: { rejectUnauthorized: false }`. Ja tentamos `true` (verificacao real) e quebrou a conexao em producao — o pooler Supavisor da Supabase devolve um erro de `"self-signed certificate in certificate chain"` mesmo sendo uma conexao TLS legitima. A conexao continua criptografada, so sem checagem de identidade do servidor. Nao reverter essa configuracao sem antes pinar o CA correto da Supabase (`ssl.ca`) e testar contra o pooler de producao.
- **Insercoes em lote, nao em loop**: escrita de multiplas linhas relacionadas (ex.: fontes de um benchmark salarial) usa um unico `INSERT ... VALUES (...), (...), ...` em vez de um `INSERT` por item.
- **Concorrencia limitada na ingestao periodica**: `ingestionOrchestrator.ts` processa combinacoes SKU×regiao com um limite de chamadas simultaneas (`mapWithConcurrency`), nao sequencial puro nem paralelismo total (evita martelar as APIs externas de preco).
- **Throttle de escrita por trafego de usuario**: `cloud_prices` e uma tabela historica insert-only; escritas disparadas por request de usuario (nao por ingestao agendada) sao throttladas por SKU/regiao para a tabela nao crescer proporcional ao trafego.
- **Sem `SELECT *`**: leituras de catalogo usam colunas explicitas.
- **Erros nunca ficam so em fallback silencioso**: todo `catch` que cai para fallback estatico tambem loga via `logger.error(...)` — que agora tambem vai para o Sentry quando configurado (ver "Observabilidade" abaixo).

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

Tabelas (`server/db/migrations/`):

- `cloud_skus` / `cloud_regions` (`0001`): dimensao do catalogo de compute (metadados; sem preco embutido).
- `cloud_prices` (`0001`): historico insert-only de preco por SKU/regiao (o preco "atual" e a linha mais recente).
- `fx_rates` (`0001`): historico de cotacoes PTAX.
- `market_benchmark_searches` / `market_benchmark_sources` (`0001`): historico de buscas de benchmark salarial (substitui o cache em arquivo `data/cache/market-benchmark-history`).
- `ingestion_runs` (`0001`): uma linha por execucao de coletor/ingestao (servico, status, registros atualizados, duracao, erro) — base do painel de observabilidade em `/system-health` e na tela "Fontes".
- `storage_prices` (`0003`): historico de preco de armazenamento (EBS gp3), mesmo padrao insert-only de `cloud_prices`.
- `cloud_architectures` + `architecture_services` (`0004`, recriada em `0005`): unica coisa que o usuario persiste com nome — uma arquitetura de infra cloud como composicao de N servicos (Cloud Architecture Calculator). `cloud_architectures` guarda nome, provider/regiao "primarios" (do primeiro servico), moeda e os totais agregados; `architecture_services` guarda 1 linha por servico (service_id, categoria, regiao, `configuration` jsonb, preco calculado no momento do save). Insert/update sao transacionais (`withTransaction`) — nunca fica uma arquitetura com servicos parciais. Editar/duplicar recalculam ou copiam o preco; nao ha versionamento historico (update sobrescreve).
- `users` / `permissions` / `user_permissions` (`0006`): RBAC — usuario (nome, e-mail unico, `password_hash`, `role`, `status`, `must_change_password`), catalogo fixo de 3 permissoes (seed da propria migration) e o relacionamento N:N entre usuario e permissao. `audit_logs` (`0006`): schema pronto pra auditoria futura, ainda nao escrito por toda acao nesta V1.

## Ingestao Periodica (Lambda + EventBridge)

A logica de ingestao vive em `server/src/domain/services/ingestionOrchestrator.ts` (compartilhada entre dois pontos de entrada, para nao duplicar codigo):

- `server/lambda/refreshSourcesHandler.ts`: handler da Lambda `pivo-refresh-sources`, disparada por um EventBridge Scheduled Rule a cada ~5 dias (`cron(0 6 1,6,11,16,21,26 * ? *)`; cron e baseado em calendario, entao o intervalo real varia entre 4 e 6 dias na virada do mes). Autentica na AWS Pricing API via **IAM Role de execucao** — nao usa access key fixa. `DATABASE_URL` e `GOOGLE_CLOUD_BILLING_API_KEY` sao variaveis de ambiente da funcao.
- `server/scripts/refreshSources.ts`: mesma logica, para rodar manualmente em dev (`pnpm run refresh-sources`).

Empacotamento: `pnpm run build:lambda` gera um bundle CJS unico (`dist-lambda/index.cjs`, via esbuild) e `scripts/deploy-lambda.ps1` cria/atualiza a IAM Role (policy minima `pricing:GetProducts`/`pricing:DescribeServices`), a funcao Lambda e o EventBridge Scheduled Rule via AWS CLI. A Lambda nao fica em VPC (acesso direto a internet, sem custo de NAT Gateway) para alcancar o Postgres (Supabase) e as APIs HTTPS publicas.

Para cada SKU/regiao do catalogo, a ingestao consulta o coletor real (Azure/AWS/GCP) e grava o preco em `cloud_prices`; tambem atualiza `fx_rates`. Cada fonte grava um resumo em `ingestion_runs`.

Azure tambem continua com consulta ao vivo por requisicao a partir do proprio app web (nao depende da Lambda). AWS e GCP **nao** sao consultados ao vivo pelo app web — o servico "Compute" do pricing engine (`POST /cloud/services/:id/price`) so le o ultimo preco gravado em `cloud_prices` (ou o snapshot estatico, se ainda nao houver ingestao para aquele SKU/regiao). Isso evita expor credencial AWS/GCP no servico web e evita o custo/latencia de uma chamada cara (o coletor GCP pagina milhares de SKUs) por requisicao. Toda chamada Azure ao vivo bem-sucedida tambem grava uma linha em `cloud_prices`, mantendo o Postgres fresco entre as janelas da Lambda.

## Observabilidade

- **Servicos externos**: `/system-health` combina checagem ao vivo (BACEN, Azure, PNCP) com a ultima linha de `ingestion_runs` por servico (AWS, GCP) — status, quantidade de registros atualizados, duracao e erro da ultima execucao. O `warning` de cada fonte nunca expoe detalhe tecnico interno (nome de variavel de ambiente, identificador de SKU/regiao) ao usuario final — mensagem generica ("usando dados de referencia internos"); o detalhe completo continua nos logs/Sentry. Tambem devolve `meta: { version, commit, environment }` (versao do `package.json`, `RENDER_GIT_COMMIT` truncado, rotulo de `APP_ENV`) — exibido no rodape do app.
- **Consultas ao Postgres**: `server/src/infrastructure/db/client.ts` mede duracao e erro de cada consulta nomeada e acumula contadores em memoria (`observability/queryStats.ts`), expostos em `/system-health` (`database.queries`) e na tela "Fontes". Consultas acima de 500ms geram um log de aviso estruturado.
- **Error tracking (Sentry)**: `observability/logger.ts` encaminha todo `logger.error(...)` para o Sentry quando `SENTRY_DSN` esta configurada (`observability/sentry.ts`) — no-op sem a variavel, entao nao ha dependencia dura do servico. Testado e confirmado em producao (ver `CHANGELOG.md`). Plano free (5.000 eventos/mes, 1 usuario).
- **Uptime monitoring (UptimeRobot)**: monitor HTTP(s) externo (fora do repositorio) checando `GET /api/v1/healthz` a cada 5 minutos. Cuidado ao reconfigurar: a URL real de producao e `https://pivo-i8m3.onrender.com` (ver "URL De Producao" em `REQUISITOS-INFRA.md`), nao `pivo.onrender.com` (dominio de outra conta).
- Isso e observabilidade leve (contadores desde o start do processo + logs + error tracking gratuito), nao uma APM completa — adequado ao estagio atual (instancia unica, free tier); os logs estruturados (JSON por linha) ficam disponiveis no log viewer do Render para investigacao mais profunda.
- Setup detalhado (contas, DSN, URLs): [REQUISITOS-INFRA.md](REQUISITOS-INFRA.md#observabilidade-gratuita-sentry--uptimerobot).

## API Publica

Todas as rotas ficam sob `/api/v1`:

- `GET /healthz`
- `GET /system-health`
- `GET /fx/ptax`
- `GET /cloud/services` — catalogo pesquisavel de servicos (busca + filtro por provider/categoria).
- `POST /cloud/services/:serviceId/price` — calcula o preco de 1 servico (Pricing Engine).
- `POST /cloud/architectures` — cria uma arquitetura (recalcula o preco de cada servico no momento do save).
- `GET /cloud/architectures` — lista resumida (nome, provider, regiao, moeda, totais, qtd. de servicos).
- `GET /cloud/architectures/:id` — detalhe completo (com os servicos).
- `PUT /cloud/architectures/:id` — atualiza (renomear/adicionar/remover servicos), recalcula os precos.
- `DELETE /cloud/architectures/:id`
- `POST /cloud/architectures/:id/duplicate` — copia o snapshot ja salvo, sem recalcular preco.
- `GET /labor/profiles`
- `POST /labor/estimate`
- `POST /market-benchmark/search`
- `GET /market-benchmark/history`
- `GET /licenses/catalog`
- `GET /auth/session` / `POST /auth/login` / `POST /auth/logout` / `POST /auth/change-password`
- `GET /admin/users` / `POST /admin/users` / `PUT /admin/users/:id` / `POST /admin/users/:id/activate` / `POST /admin/users/:id/deactivate` — todas atras de `requireRole("ADMIN")`

## Dados E Persistencia

O Postgres (Supabase, ver "Banco De Dados" acima) e a fonte de verdade para catalogo de cloud, precos, cotacao PTAX e historico de benchmark. O cache de resiliencia em arquivo (`data/cache`) continua existindo como fallback de nivel 3 quando `DATABASE_URL` nao esta configurado ou o Postgres esta fora do ar — ele:

- melhora a experiencia quando uma fonte externa e o banco falham juntos;
- nao deve ser usado como registro permanente;
- pode ser perdido em provedores com filesystem efemero, como Render Free (por isso a migracao para Postgres).

Decisao de produto (2026-09-05): nao havera modulo de "Propostas" — a unica coisa que o produto persiste com nome e uma arquitetura de infra cloud (`cloud_architectures`, ver acima). Usuarios/permissoes (RBAC, ver acima) tambem sao persistidos no Postgres desde 2026-09-07.

## Deploy

O artefato principal e o `Dockerfile`. O `render.yaml` descreve um Web Service gratuito no Render com:

- runtime Docker;
- health check em `/api/v1/healthz`;
- `NODE_ENV=production`;
- variaveis secretas para `SESSION_SECRET`, `DATABASE_URL` e conector opcional de benchmark.

Detalhes:

- [deploy-render.md](deploy-render.md)
- [deploy-teste.md](deploy-teste.md)
- [REQUISITOS-INFRA.md](REQUISITOS-INFRA.md)

## Pendencias Arquiteturais

- Substituir snapshots de CAGED/MTE por pipeline real de ingestao (o MTE so disponibiliza microdados via FTP, sem API — exige um pipeline de download/parse periodico).
- Expandir o PNCP alem da checagem de saude: hoje `pncpCollector.ts` so prova que a API esta no ar (contagem de contratacoes recentes); buscar preco de referencia por item exigiria paginar `/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}` e casar a descricao do item com o catalogo do Pivo.
- Rodar `scripts/deploy-lambda.ps1` (cria a IAM Role/policy, a Lambda e o EventBridge Rule) e configurar `GOOGLE_CLOUD_BILLING_API_KEY` para validar a primeira ingestao AWS/GCP em producao — o coletor GCP em particular usa casamento de SKU por descricao/regiao que so pode ser confirmado com uma chave real.
- Ampliar dimensoes de custo da calculadora cloud: storage (EBS/Persistent Disk), transferencia de dados, banco gerenciado (RDS/Cloud SQL) — hoje cobre so compute on-demand.
- Escrever `audit_logs` de fato (schema pronto desde a migration `0006`, so nao populado por toda acao administrativa ainda).
- Sem modulo de propostas — decisao de produto.
- Separar dominio em modulos menores quando o volume de regras crescer.
- Criar MCP server previsto no PRD.
- Publicar workflow CI/CD quando a credencial GitHub tiver escopo `workflow`.
