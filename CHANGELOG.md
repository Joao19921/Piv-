# Changelog

Registro de mudanças relevantes de engenharia e de infraestrutura/governança do Pivô. Formato livre, em português, orientado a decisão (o quê + por quê), não apenas a lista de commits — para isso, ver `git log`.

## 2026-09-05 — Preço ao vivo para Azure Storage/SQL/Load Balancer/Functions

Usuário compartilhou dois scripts Python (`azure_pricing_export.py`, `gcp_pricing_export.py`) que exportam o catálogo de preços da Azure Retail Prices API e da GCP Cloud Billing Catalog API para Excel. Pedido: verificar se já estava implementado e, se válido, implementar.

- **Confirmado**: as duas APIs já eram usadas no projeto, mas só para compute (Azure VM, GCP Compute Engine). Os 4 serviços Azure não-compute do catálogo (Storage, SQL, Load Balancer, Functions) ainda eram preço estático estimado.
- **Implementado só para Azure**: a Azure Retail Prices API é pública, sem chave, e o app já a chama ao vivo por requisição (mesmo padrão do compute). Estendido para os 4 serviços, com filtros verificados manualmente contra a API real antes de implementar (ver commit `e6ffe78`). Achado importante: o medidor de execuções/duração do Functions tem uma faixa gratuita inicial (`retailPrice: 0`) antes da faixa paga — pegar ingenuamente "o primeiro tier" teria zerado o preço; a função `representativePrice()` ignora faixas gratuitas quando existe uma paga.
- **Não implementado para GCP/AWS**: a arquitetura atual chama GCP/AWS ao vivo só pela Lambda de ingestão periódica, nunca por requisição do app web — decisão deliberada, documentada em ARQUITETURA.md, para não expor credencial no serviço web e não pagar o custo de paginar milhares de SKUs a cada requisição. Replicar o script da GCP diretamente no app web quebraria esse princípio. O caminho correto é estender a ingestão da Lambda (já registrado no roadmap do README, item 7) — maior escopo, não feito nesta entrega.
- Validado com curl contra a API real e contra o banco de produção (salvar uma arquitetura com os 4 serviços): todos os totais batem exatamente com o cálculo manual a partir dos preços retornados pela API.

## 2026-09-05 — Infra Cloud vira um Cloud Architecture Calculator completo

Pedido explícito do produto (spec detalhada, inspirada no AWS/Azure Pricing Calculator): transformar "Infra Cloud" de uma cesta de 1 SKU numa ferramenta real de montar/calcular/salvar arquiteturas com múltiplos serviços.

### Auditoria (antes de qualquer mudança de código)

Levantamento pedido explicitamente pelo produto: mapeamento de rotas, páginas, hooks, banco, código morto. Achados: nenhuma rota de proposta/CRM jamais existiu no backend (era decoração de frontend, já removida em 2026-09-04); catálogo de cloud era só compute (sem RDS/S3/Lambda/etc.); `cloud_architectures` guardava 1 SKU por linha; sem testes (`vitest` never configurado); dois componentes órfãos nunca importados por nada (`Map.tsx`, `ManusDialog.tsx`, sobras do scaffold original) — removidos junto desta mudança.

### Decisões de escopo (perguntadas ao usuário antes de implementar)

- Mão de obra e Licenças **continuam** como módulos separados (o pedido mirava especificamente Infra Cloud, não o produto inteiro).
- GCP **continua** como 3º provider — já tinha preço ao vivo real via Cloud Billing API; removê-lo seria regressão.
- Catálogo de serviços: **completo** já nesta entrega (Compute, Storage, Database, Networking, Containers, Serverless, CDN × AWS/Azure/GCP — 21 entradas).
- Diagrama visual da arquitetura: **incluído** já nesta entrega.

### Backend

- `cloudServiceCatalog.ts`: catálogo pesquisável de 21 serviços. Compute (EC2/Azure VM/GCE) reaproveita o preço ao vivo já existente; os demais (RDS, S3, Lambda, VPC→Load Balancer, EKS, CloudFront, etc.) são catálogo estático com preço de referência pública, **sempre** com `source`/`estimated`/`sourceUrl` explícitos — nunca apresentados como preço oficial ao vivo.
- `pricingEngine.ts`: motor de cálculo único, separado da UI e das rotas (`calculateServicePrice(serviceId, region, config)`).
- Migration `0005`: `cloud_architectures` deixa de ter 1 SKU e vira 1-N com `architecture_services` (serviço + config jsonb + preço, um por linha).
- `withTransaction()` novo em `db/client.ts`: criar/editar uma arquitetura agora é atômico (nunca fica com serviços parciais se algo falhar no meio).
- Rotas: `GET /cloud/services`, `POST /cloud/services/:id/price`, e CRUD completo de `/cloud/architectures` (criar, listar, detalhar, editar, excluir, duplicar). Substituem `/cloud/catalog` e `/cloud/estimate` (aposentadas).

### Frontend

- `client/src/pages/cloud/CloudArchitect.tsx`: tela nova com lista de arquiteturas (estado vazio real, sem métrica fictícia) e um builder em 3 painéis — catálogo pesquisável | serviços adicionados + diagrama visual por camada (Edge/Rede → Aplicação → Dados, sem inventar conexão ponto-a-ponto) | resumo de custo por categoria com toggle BRL/USD.
- Modal de configuração por serviço com campos dinâmicos e preço recalculado ao vivo (debounced) a cada mudança.

### Validação

Rodado com Playwright (headless Chromium) contra o app real (Vite dev + backend + Postgres de produção): busca de serviço → configuração → preço ao vivo aparecendo no modal → adicionar → nomear → salvar → aparece na lista. Zero erros de console relacionados à feature (os 3 erros 500 encontrados eram as imagens decorativas do dashboard, que já falhavam antes desta mudança por falta de config do proxy de storage em dev local — não relacionado). Build de produção (vite + esbuild) e `tsc --noEmit` limpos. Registro de teste removido do banco após validação.

## 2026-09-05 — Remove UI não-funcional; "salvar" vira uma feature real (arquiteturas de cloud)

Pedido explícito do produto: o site tinha vários elementos que pareciam funcionais mas não eram — sobras da primeira versão (protótipo visual) que nunca foram plugadas a nada real.

### Removido

- **Módulo "Propostas" inteiro** — nav, seção, e os dados fabricados (`proposalRows`, 3 "projetos" inventados). Todo botão que apontava para lá também saiu (hero, quick actions, header).
- **Busca global no header** — só mostrava um toast (`"Busca global pronta..."`), não buscava nada.
- **Sino de notificações no header** — só mostrava um toast (`"Nenhuma nova notificação"`), nunca teve notificação real.
- **Botão de configurações na sidebar** — só mostrava um toast, não levava a lugar nenhum.
- **Botões de "salvar" que não salvavam**: "Salvar simulação" (mão de obra) e "Usar na proposta" (licenças) — ambos só disparavam um toast de sucesso fake, sem persistir nada em lugar nenhum.
- **Gráfico "Pipeline de propostas" no dashboard** — série de 6 meses com valores inventados (`trendData`), sem nenhuma fonte real por trás.
- **2 métricas fabricadas no dashboard** — "Margem média: 27,4%" e "Projetos em rascunho: 08", números fixos no código, não vinham de lugar nenhum. As 2 métricas que sobraram ("Fontes operacionais", "PTAX de referência") passaram a ser calculadas de verdade a partir de `/system-health`.

### Adicionado — a única coisa que passou a salvar de verdade

- Nova tabela `cloud_architectures` (migration `0004`, aplicada via Supabase MCP direto no projeto `pivo`): guarda nome, provider, região, SKU, instâncias, horas, storage e a estimativa (USD/BRL) no momento do save.
- Rotas `POST` e `GET /api/v1/cloud/architectures` — validam entrada, persistem, e listam as arquiteturas salvas (mais recentes primeiro).
- No módulo Infra Cloud: campo de nome + botão "Salvar arquitetura" real (chama a API, mostra erro/sucesso reais via `toast.promise`) e uma lista "Arquiteturas salvas" abaixo, alimentada pela API.
- Testado ponta a ponta contra o Postgres de produção antes do commit (save + list + validação de erro), registro de teste removido do banco em seguida.

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
