# Changelog

Registro de mudanças relevantes de engenharia e de infraestrutura/governança do Pivô. Formato livre, em português, orientado a decisão (o quê + por quê), não apenas a lista de commits — para isso, ver `git log`.

## 2026-09-04 — Revisão de consultas ao banco + observabilidade gratuita

### Correções em consultas ao Postgres (`server/src/infrastructure/`, `server/src/domain/services/`)

- **`SELECT *` sem colunas explícitas** em `cloudPricingRepository.listSkus()` — trocado por lista de colunas nomeada.
- **N+1 de escrita** em `marketBenchmarkRepository.insertBenchmarkSearch()` — um `INSERT` por fonte salarial (5-8 por busca) virou um único `INSERT` multi-row.
- **N+1/serialização na ingestão periódica** (`ingestionOrchestrator.ts`) — loop aninhado SKU×região e o loop de storage por região agora rodam com concorrência limitada (`mapWithConcurrency`, limite de 4 chamadas simultâneas) em vez de sequencial puro.
- **Crescimento descontrolado de `cloud_prices`** — o insert fire-and-forget do preço Azure ao vivo em `GET /cloud/estimate` gravava a cada request de usuário (tabela histórica insert-only). Agora é throttlado: só grava se o último preço conhecido daquele SKU/região tiver mais de 1h (`PRICE_REFRESH_THROTTLE_MS`).
- **Erro engolido silenciosamente** em `GET /system-health` (falha ao ler `ingestion_runs`) — agora loga antes do fallback.
- **Validação de schema em runtime no frontend** (`client/src/lib/api.ts`) — `zod` já era dependência mas não era usado; todos os `fetch*` agora validam a resposta com `.parse()`, e os tipos exportados passaram a ser derivados dos schemas (`z.infer`) para tipagem estática e validação em runtime não poderem divergir.

### Incidente: TLS do Postgres (revertido)

- Mudança inicial: `ssl: { rejectUnauthorized: false }` → `true` em `db/client.ts`, para reativar verificação de certificado (proteção contra MITM).
- **Quebrou em produção**: o pooler Supavisor da Supabase (`aws-0-sa-east-1.pooler.supabase.com:6543`) devolve `"self-signed certificate in certificate chain"` com verificação ativa — confirmado ao invocar a Lambda de ingestão (`{"ok":false,"reason":"self-signed certificate in certificate chain"}`).
- **Revertido** para `rejectUnauthorized: false` (mesmo valor de antes), com comentário no código explicando a causa e a decisão. Conexão ainda é criptografada (TLS), só sem checagem de identidade do servidor — aceitável dado que a conexão sai de dentro da infraestrutura AWS/Render para a Supabase.
- Pendente, se algum dia quisermos verificação real: pinar o CA correto da Supabase via `ssl.ca` em vez de desabilitar a verificação.

### PNCP — fonte de dados real (`server/src/infrastructure/collectors/pncpCollector.ts`)

- Substituída a entrada hardcoded `"PNCP: pendente"` em `/system-health` por uma checagem de saúde real, sem chave: `GET https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao` (mesmo padrão de resiliência — circuit breaker/retry/cache — dos demais coletores).
- Escopo atual é só prova de vida (conta contratações recentes); buscar preço de referência por item exigiria paginar `/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}` e casar a descrição do item com o catálogo — não implementado.
- CAGED/MTE continua como snapshot: o Ministério do Trabalho só disponibiliza microdados via FTP (arquivos `.txt`), sem API REST.

### Sentry (error tracking gratuito) — `server/src/infrastructure/observability/sentry.ts`

- `logger.error(...)` (usado em todo o backend) agora também envia para o Sentry quando `SENTRY_DSN` está configurada; sem a variável, comportamento idêntico ao anterior (só stdout).
- Organização: `agentanalisedegoverno.sentry.io`, projeto `pivo` (slug `PIVO-1`).
- Testado localmente (evento `c2f8d5bc...`) e **confirmado em produção** via rota de diagnóstico temporária (`GET /api/v1/_debug/sentry-test`, protegida pelo mesmo gate de sessão das demais rotas) — evento `PIVO-2`, `environment: production`. Rota removida logo após a confirmação.
- `SENTRY_DSN` adicionada a `render.yaml` (secret), `.env.example` e ao script `scripts/deploy-lambda.ps1` (opcional, mesmo padrão de `GOOGLE_CLOUD_BILLING_API_KEY`).

### UptimeRobot (uptime monitoring gratuito)

- Monitor HTTP(s) criado apontando para `GET /api/v1/healthz` do serviço em produção.
- **Achado durante a configuração**: o domínio óbvio `pivo.onrender.com` **não é o nosso serviço** — é um app Python/uvicorn de outra conta que já tinha registrado esse nome (nomes de serviço são globais no Render). A URL real é `https://pivo-i8m3.onrender.com` (o Render sufixou automaticamente). Documentado com destaque em `docs/REQUISITOS-INFRA.md` e `docs/deploy-render.md` para não repetir o erro.

### Keep-alive do Supabase (cron-job.org)

- Cron job externo (fora do repositório), gratuito, batendo em `GET https://hiwpskashaypuvwvibds.supabase.co/rest/v1/` 1x/dia — evita o projeto Supabase free pausar após ~7 dias de inatividade. Usa a raiz do PostgREST (não uma tabela) porque todas as tabelas têm RLS habilitado sem policies, então qualquer chamada de tabela com a chave `anon` voltaria vazia/negada.

### Referência: onde cada coisa foi documentada

- `docs/REQUISITOS-INFRA.md` — URL de produção, Sentry, UptimeRobot, keep-alive do Supabase (passo a passo de configuração).
- `docs/ARQUITETURA.md` — padrão de resiliência, fontes de dados, observabilidade (visão de arquitetura).
- `docs/deploy-render.md` — URL real de produção e o aviso sobre o domínio colidido.
