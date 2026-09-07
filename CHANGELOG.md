# Changelog

Registro de mudanças relevantes de engenharia e de infraestrutura/governança do Pivô. Formato livre, em português, orientado a decisão (o quê + por quê), não apenas a lista de commits — para isso, ver `git log`.

## 2026-09-06 — Botão "Limpar dados" em Mão de obra

Pedido do usuário: um botão pra apagar tudo na tela de Mão de obra e liberar os campos pra uma nova busca, sem precisar recarregar a página.

Adicionado no cabeçalho da seção (`LaborPricing`, `Home.tsx`): zera perfil, remuneração, Fator K, margem e os campos de busca de benchmark (cargo, cidade, observações — Estado e o toggle CLT/PJ voltam ao padrão SP/PJ por serem seletores de valor único, não texto livre). Chama `benchmarkSearch.reset()` (mutation do react-query) pra descartar o resultado da última busca manual — sem isso, um novo estado `benchmarkDismissed` também precisou ser adicionado, porque o painel de benchmark tinha um segundo fallback (`historyData.entries[0]`, a última consulta salva no Postgres) que reapareceria sozinho mesmo com os campos em branco. `benchmarkDismissed` é religado assim que o usuário dispara uma nova busca.

Verificado com Playwright: todos os campos de texto ficam vazios após o clique (checado via `inputValue()`, não só visualmente — o placeholder de "Cidade" parece preenchido mas o campo está vazio), o painel de resultado some, e o toast de confirmação aparece.

## 2026-09-06 — Revisão de UX: navegação real, badges honestos, conversão BRL, exportação e limpeza de acentuação

Lista de 10 problemas reportada pelo usuário após testar a aplicação em produção. Do mais grave ao mais cosmético:

**Navegação não gerava URL real (raiz do "atalho leva ao lugar errado")**: `Home.tsx` guardava a seção ativa em `useState` local — toda navegação ficava em `/`, então o botão Voltar do navegador, favoritar e compartilhar link de um módulo não funcionavam, e não havia como confirmar visualmente que um clique tinha navegado. Migrado pra rotas reais do wouter: `/`, `/mao-de-obra`, `/infra-cloud`, `/licencas`, `/fontes` (constante `SECTION_PATHS` em `App.tsx`); `Home` passa a receber a seção como prop derivada da rota, `navigate()` chama `setLocation()`. Os 3 atalhos da Visão Geral já estavam mapeados corretamente no código (01→mão de obra, 02→cloud, 03→licenças) — o problema real era a ausência de URL, não o mapeamento; verificado com Playwright clicando em cada atalho e confirmando a URL, incluindo o botão Voltar do navegador.

**Mensagem técnica crua com nome de variável de ambiente exposta ao usuário**: `fromIngestionRun()` (app.ts) repassava `run.errorMessage` cru pro campo `warning` da API — pra GCP isso incluía literalmente `GOOGLE_CLOUD_BILLING_API_KEY nao configurada` concatenado por região. Mesmo problema achado num segundo lugar: `gcpCollector.ts` lançava esse erro cru, que podia vazar direto num toast ao tentar precificar compute GCP no Cloud Architect (`/cloud/services/:id/price` repassa `err.message` pro cliente). Os dois agora usam mensagens genéricas ("usando dados de referência internos" / "credencial não configurada", sem nome de env var); o detalhe técnico completo continua em `ingestion_runs` (Postgres) e nos logs/Sentry, só não é mais exibido cru na tela. Mesma limpeza na tabela "Ingestão periódica" da página Fontes: o texto truncado com identificador de SKU/região foi trocado por uma frase genérica.

**Contradição "Sistema estável" com fontes em fallback, e AWS/GCP marcados "Online" com leitura de 19h**: rótulo do widget lateral agora é calculado (`Sistema estável` / `Sistema parcial` / `Sistema indisponível`) a partir da contagem real de fontes operacionais, com cor do indicador acompanhando. E como AWS Pricing API e GCP Cloud Billing Catalog só atualizam por ingestão periódica (a cada ~5 dias via Lambda/EventBridge, não por requisição), ganharam um badge próprio — "Atualizado" (azul) — em vez de "Online" (verde), que fica reservado pras fontes realmente ao vivo por requisição (PTAX, Azure Retail API, PNCP). Isso remove a aparência de contradição sem inventar um limiar de idade que seria errado pra esse tipo de fonte (19h é normal pra uma ingestão de 5 em 5 dias).

**Acentuação inconsistente**: passe amplo em todo texto voltado ao usuário — UI (`Home.tsx`, `CloudArchitect.tsx`, `LoginPage.tsx`), mensagens de erro/warning retornadas pela API (`app.ts`, `pricingEngine.ts`, `marketBenchmark.ts`, coletores AWS/Azure/GCP/PNCP) e dados de catálogo (`catalogs.ts`, `cloudServiceCatalog.ts` — títulos de perfil, notas de licença, labels de campo de configuração como "Duração média (ms)"/"Memória (MB)"). Corrigido com um script de substituição por palavra inteira + verificação de build a cada rodada (pra pegar qualquer identificador de código corrompido por engano) — nenhum foi encontrado. Dois valores de enum precisaram de troca coordenada em 2 arquivos ao mesmo tempo (`catalogs.ts` + `client/src/lib/api.ts`, que valida a resposta via zod): categoria de licença `Seguranca`/`Colaboracao` → `Segurança`/`Colaboração`, e senioridade `Senior`/`Junior` → `Sênior`/`Júnior` — trocar só um lado teria recriado o mesmo bug de validação zod já corrigido nesta semana. Fora do escopo desta entrega: comentários internos de código nos demais arquivos do backend (não afetam o que o usuário vê) e a acentuação dos `.md` em `docs/`.

**Infra Cloud sem exemplo pronto**: estado vazio ganhou um botão "Ver exemplo pronto" que carrega 3 serviços AWS estáticos (Load Balancer + RDS + S3, já precificados) direto no calculador, sem salvar nada — só pra avaliar o cálculo antes de montar do zero.

**Licenças em dólar sem conversão em reais**: `LicensesCatalog` passou a consultar a mesma cotação PTAX já usada no dashboard e mostrar o equivalente em BRL por item e no total, com a cotação usada explícita ("cotação PTAX R$ X,XX").

**Sem exportação**: botão "Baixar CSV" em Licenças (itens filtrados + total, USD e BRL) e no Cloud Architect (serviços da arquitetura + total), formato compatível com Excel pt-BR (separador `;`).

**Sem indicação de versão/ambiente, rodapé desatualizado**: `/system-health` agora devolve `meta: { version, commit, environment }` (versão do `package.json`, commit curto via `RENDER_GIT_COMMIT` — injetada pelo Render em runtime — e um rótulo de ambiente configurável via `APP_ENV`, default "Homologação"); exibido no rodapé. O rodapé também trocou o texto fixo "BACEN PTAX + Azure Retail API" (que ignorava PNCP e AWS já estarem ativos) por uma lista calculada das fontes realmente operacionais no momento.

Verificado: `pnpm run check` limpo após cada rodada de substituição em massa (rede de segurança contra corromper identificador de código sem querer); build de produção + Playwright cobrindo navegação real (URL muda, Voltar funciona), badge "Atualizado" vs "Online", acentuação nos 3 pontos mais visados (Licenças, drawer de configuração do Cloud Architect, página Fontes) e o fluxo completo do "Ver exemplo pronto".

## 2026-09-06 — Limpeza de governança: remove artefatos da plataforma de scaffolding (Manus) e arquivos órfãos

Pedido do usuário: revisar o repositório todo com lente de compliance/governança/segurança e remover pastas e referências sem sentido, em particular vestígios de ferramentas de IA usadas no bootstrap do projeto.

**Achado mais sério — telemetria de terceiros embarcada em produção**: `client/public/__manus__/debug-collector.js` (rastreado no git) é copiado pelo Vite para **todo build de produção** (`dist/public/__manus__/`). É um script da plataforma Manus (usada para gerar o scaffold inicial do projeto) que intercepta `console.*`, `fetch`/`XHR` (corpo de requisição e resposta incluídos) e todo evento de UI (clique, digitação, navegação), e envia tudo para `/__manus__/logs`. A redação de campos sensíveis é só por nome de chave (substring match em `password`/`token`/`secret`/etc.), não por valor — não cobre, por exemplo, um token dentro de uma URL ou de um corpo sem esse nome de campo. O script só era **injetado automaticamente** em dev (`transformIndexHtml` checava `NODE_ENV !== "production"`), mas o arquivo em si sempre foi servido publicamente em produção por estar em `client/public/`. Removido do repositório; build de produção verificado sem a pasta `__manus__` no output.

Também removido de `vite.config.ts`:
- Plugin `vite-plugin-manus-runtime` (runtime específico do ambiente hospedado da Manus, sem função fora dele).
- Middleware de captura de logs (`/__manus__/logs`, escrevia em `.manus-logs/*.log` local — chegou a acumular >1MB de console/rede/replay de sessão).
- Proxy `/manus-storage` (dependia de `BUILT_IN_FORGE_API_KEY`, credencial da plataforma Manus, inexistente fora dela).
- `allowedHosts` com domínios `*.manus*.computer` do ambiente de preview hospedado.
- `@builder.io/vite-plugin-jsx-loc`: injetava atributo `data-loc="arquivo:linha:coluna"` em todo elemento renderizado — vazava caminho de arquivo interno do servidor no HTML público. Confirmado via build: zero ocorrências de `data-loc` no bundle final após a remoção.

**Efeito colateral descoberto durante a limpeza**: com o proxy `/manus-storage` fora do ar (só existia em dev), as 3 imagens decorativas do dashboard (`Home.tsx` — hero da Visão Geral e os 2 cards de atalho) já estavam quebradas em produção (404 silencioso, apontavam para `/manus-storage/pricing-engine-*.png`, hospedado só no storage da Manus). Removidas as referências às imagens; hero substituído por um fundo neutro (gradiente + grid), atalhos sem imagem de fundo. Validado com Playwright contra o build de produção local — sem ícone de imagem quebrada, dados reais das 7 fontes carregando normalmente.

**Arquivos/pastas órfãos removidos** (sobras do scaffold inicial, sem relação com o produto atual, confirmado sem nenhuma referência restante no código): `template.json` (14KB de template genérico "Web App" de outra ferramenta, não usado), `ideas.md` e `todo.md` (notas de ideação de marca da fase de bootstrap, todos os itens já concluídos), `dev-server.log` (log solto na raiz), `.manus-logs/` (logs locais gerados pelo middleware removido). Pasta `identidade visual/` (nome com espaço, 3 JPGs de marca) movida para `docs/assets/identidade-visual/` com nomes de arquivo sem espaço; referência em `docs/identidade-visual-pivo.md` atualizada.

**Não corrigido nesta entrega**: `docs/identidade-visual-pivo.md` e `docs/kit-de-marca-pivo.md` ainda linkam logos em `/manus-storage/pivo-logo-*.png` — essas imagens só existiam no storage da Manus e não há cópia local para restaurar; os links de imagem nesses dois documentos de marca ficam quebrados até alguém re-exportar os logos. Baixo risco (documentação, não o app), mas fica registrado.

Verificado: `pnpm run check` (typecheck) e `pnpm run build` limpos após a remoção das duas dependências (`vite-plugin-manus-runtime`, `@builder.io/vite-plugin-jsx-loc`) e a atualização do lockfile.

## 2026-09-05 — Licenças e Mão de obra retornavam vazio (bug real de validação zod)

Usuário reportou "Licenças" mostrando "0 de 0 itens" em produção, reproduzível (não era transiente). O handler de erro global (item anterior) não pegou nada — porque o erro **não era no backend**. Diagnóstico final: pedi o cookie de sessão real do usuário e chamei a API de produção diretamente (`curl` autenticado) — resposta 200, JSON perfeito, 23 itens.

Causa raiz: `apiSourceResultSchema()` (client/src/lib/api.ts) exige `data: dataSchema.nullable()` — aceita `null` explícito, mas **não** chave ausente (`undefined`). As rotas `/labor/profiles` e `/licenses/catalog` nunca incluíam `data` no objeto `source` (são snapshots estáticos sem payload real) — isso já estava assim desde antes, só que a validação zod (adicionada numa sessão anterior) nunca foi checada contra a resposta real de *todas* as rotas existentes na hora de implementar. Efeito: `fetchLicenseCatalog()`/`fetchLaborProfiles()` sempre lançavam `ZodError`, a query ficava em erro, e a tela renderizava vazio sem nenhum erro visível nem no console nem no backend (o erro acontecia no navegador, depois da resposta chegar).

Corrigido nos dois lados: as 2 rotas passam a incluir `data: null` explicitamente; `apiSourceResultSchema()` usa `.nullable().default(null)` em vez de só `.nullable()`, tratando chave ausente e `null` da mesma forma (defesa contra qualquer outra rota com o mesmo padrão que não foi vista). Verificado rodando o schema real via `tsx` contra a resposta de produção capturada por `curl`: falhava antes do fix, passa depois.

**Lição**: o handler de erro global do item anterior cobre erros de *backend*; esse aqui era um erro de *parsing no cliente*, invisível para ambos Sentry e logs até alguém literalmente rodar o parser contra os dados reais.

## 2026-09-05 — Handler de erro global na API (lacuna real de observabilidade)

Motivado por um bug relatado em produção (seção Licenças retornando "0 de 0 itens", sem nenhum rastro útil no console do navegador). Ao investigar, não foi possível confirmar a causa raiz porque **nada era logado no backend nem no Sentry** — o gap:

- Uma exceção síncrona numa rota do Express virava a página HTML de erro padrão, sem passar pelo nosso `logger.error()` (e portanto sem chegar no Sentry).
- Uma exceção numa rota `async` (a maioria das rotas do app) — sem `express-async-errors` — nem chega a virar um erro tratado: vira uma promise rejeitada solta, a requisição trava sem resposta, e nada é logado.

Corrigido: `express-async-errors` (encaminha erros async pro middleware de erro, igual já acontecia com síncronos) + um handler de erro global em `server/index.ts` sob `/api/v1` que loga via `logger.error` (forwarding pro Sentry) e devolve JSON 500. Testado localmente com rotas de teste síncrona e assíncrona antes do commit — ambas confirmadas no log com stack trace completo.

Não foi possível confirmar se esse handler teria capturado o incidente original do dia (o Network tab do navegador não chegou a ser inspecionado com sucesso durante o diagnóstico), mas fecha a lacuna para qualquer erro de rota daqui pra frente.

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
