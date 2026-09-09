# Changelog

Registro de mudanças relevantes de engenharia e de infraestrutura/governança do Pivô. Formato livre, em português, orientado a decisão (o quê + por quê), não apenas a lista de commits — para isso, ver `git log`.

## 2026-09-08 — Fase 0 de engenharia: pipeline versionado, testes no CI, gate de segurança e runner de migrations

Auditoria do repositório pedida pelo usuário ("veja se já construímos testes automatizados, de SI e compliance, e também esteira de CI/CD") antes de avaliar uma proposta de scraping de benchmark salarial. O levantamento achou quatro buracos de processo que tornavam qualquer evolução arriscada — todos corrigidos aqui.

**1. O pipeline não estava versionado.** `.github/workflows/ci.yml` estava listado no `.gitignore` (comentário: "GitHub Actions exige token com escopo workflow para push via OAuth"), então `git ls-files .github/` voltava vazio: o workflow existia no GitHub e no disco de quem o criou, mas não no repositório. Um clone limpo não tinha CI, mudanças no pipeline não passavam por PR e não havia histórico de quem mudou o quê. Removido do `.gitignore`; o pipeline agora é código revisável como o resto.

**2. Os 38 testes existiam mas nunca rodavam sozinhos.** O CI só fazia `check` + `build`. A causa de não dar para simplesmente adicionar `pnpm test`: a suíte escreve num Postgres real (cria usuários, faz login, grava histórico de benchmark, apaga tudo no teardown) e lia `DATABASE_URL` do `.env` — ou seja, rodava contra a Supabase de produção. Agora o job `test` sobe um `postgres:17-alpine` efêmero como service container, aplica o schema e roda a suíte contra ele. Isso exigiu duas mudanças de código: um runner de migrations (item 4) e TLS condicional em `db/client.ts`, que forçava `ssl` em toda conexão — contra um Postgres local, que sobe sem SSL, isso derruba a suíte inteira com "The server does not support SSL connections". `resolveSslConfig()` agora desliga o TLS para host local e aceita o override explícito `DATABASE_SSL=disable|require`; para a Supabase o comportamento é exatamente o de antes (criptografado, sem verificação de certificado, pelo motivo já documentado no arquivo).

**3. Nenhuma varredura de segurança.** Adicionado o job `security`: gitleaks (segredos, rodando antes do `pnpm install` de propósito — com `node_modules` no disco a varredura levaria minutos e acusaria segredos de exemplo de terceiros) e `pnpm audit`. O audit é dividido em dois: **gate que quebra o build** em vulnerabilidade high/critical nas dependências de produção, e um audit completo apenas informativo para ferramentas de build/teste, que não vão para o runtime.

O baseline do audit era 140 vulnerabilidades (52 high, 2 critical) — inutilizável como gate. Investigando: **`axios`, `nanoid` e `streamdown` estavam em `dependencies` sem serem importados em lugar nenhum do código** (confirmado por grep em `client/`, `server/` e `shared/`). Só o `axios` respondia por 11 dos avisos high em produção, e arrastava o `form-data` (mais um). Removidos os três, o audit de produção caiu de 73 vulnerabilidades / 17 high para 9 / 2 high — sem tocar em nenhuma linha de código de aplicação. Os 2 high restantes (`path-to-regexp` via express 4, `lodash` via recharts 2) não têm correção sem upgrade major e ficaram listados explicitamente em `pnpm.auditConfig` no `package.json`, cada um com o motivo de não ser explorável aqui e o caminho de saída. A lista é o passivo declarado: deve encolher, não crescer.

Também adicionado o Dependabot (npm, GitHub Actions, Docker), agrupando ferramentas de desenvolvimento e pacotes `@radix-ui/*` num PR só para não afogar os PRs que importam.

**4. Migrations eram aplicadas na mão.** Os 6 arquivos em `server/db/migrations/` traziam no cabeçalho "Aplicada no projeto Supabase via MCP em ..." — não havia como um banco vazio chegar ao schema atual sem alguém colar SQL manualmente, que é exatamente o que o CI precisa fazer. Novo `server/scripts/migrate.ts` (`pnpm run migrate`): aplica em ordem, uma transação por arquivo, registrando o aplicado em `schema_migrations`. Verifica checksum das já aplicadas (migration aplicada é imutável — corrigir exige arquivo novo), normalizando CRLF/LF antes de hashear para o mesmo arquivo não dar checksum diferente no Windows e no runner Linux. Tem `--dry-run` e `--baseline`; o baseline existe para o banco de produção, que já tem o schema aplicado fora do runner e onde rodar normal tentaria recriar tabelas existentes.

**Deploy deixou de ser cego.** O job `deploy` agora depende de `build`, `test` e `security` (antes dependia só do build) e, depois de disparar o hook do Render, faz polling de `/api/v1/healthz` por até 10 minutos — o hook responde na hora, antes do build do Render terminar, então até aqui ninguém descobria um deploy quebrado a não ser abrindo o app na mão.

**Primeira execução, e uma descoberta**: o pipeline quebrou de cara em dois pontos. (1) `pnpm/action-setup` abortava com `ERR_PNPM_BAD_PM_VERSION` porque a versão do pnpm vinha declarada duas vezes — `version: 10` no workflow e `packageManager` no `package.json`. Isso **não veio desta mudança**: o `packageManager` está no `package.json` desde o commit inicial (`0604ed2`) e o `ci.yml` original já trazia `version: 10`, ou seja, a esteira nunca chegou a rodar com sucesso — e não dava para perceber justamente porque o workflow estava fora do controle de versão. Removido o `version:`, a ação passa a ler o `packageManager`, que já fixa versão exata com hash de integridade. (2) O gitleaks acusou 6 vazamentos, todos senhas de fixture em `server/tests/auth.test.ts` (`SenhaInicial123`, `OutraSenha123`, `NovaSenha1234`), pegas pela regra `generic-api-key` por entropia. Novo `.gitleaks.toml` isenta esses três **valores** — não o caminho `server/tests/**`, de propósito: isentar o diretório inteiro criaria um ponto cego onde uma chave real de AWS num arquivo de teste deixaria de ser detectada.

Depois disso, os quatro jobs passaram: 6 migrations aplicadas no Postgres efêmero, **38 testes verdes em 5 arquivos**, `no leaks found`, audit de produção limpo e o smoke test respondendo 200.

**Nota de execução**: um `--dry-run` do runner novo foi disparado sem perceber que `dotenv` carrega o `.env` da raiz, então ele conectou na Supabase de produção e criou lá a tabela `schema_migrations`. Nenhuma tabela de aplicação foi tocada — as 14 continuam íntegras, confirmado por consulta ao `information_schema`. Resolvido em seguida, com aval do usuário, rodando `pnpm run migrate -- --baseline` contra produção: as 6 migrations ficaram marcadas como aplicadas sem executar SQL nenhum, que é o estado correto para esse banco. Uma segunda execução do `pnpm run migrate` confirmou a idempotência ("nenhuma migration pendente") e, de quebra, validou o caminho de verificação de checksum contra um Postgres real.

## 2026-09-08 — Benchmark sem correspondência não aplica mais perfil genérico sem avisar

Pedido do usuário: buscou "Consultor SAP FI/CO senior" e recebeu 2 fontes, as duas rotuladas "CLT" ("CLT e CLT, não entendi"), e o auto-preenchimento (feature da entrada anterior) levou pro cálculo um "Analista de Sistemas" sem nenhuma relação com o cargo buscado ("Fonte CLT - Analista de Sistemas, não entendi") — pediu também mais fontes.

**Causa raiz**: o catálogo interno de perfis não tem nenhuma categoria pra consultoria funcional de ERP/SAP (FI/CO, MM, SD, HCM etc.) — é um catálogo de cargos de TI genéricos (dev, cloud, dados, suporte, arquitetura). Cargos sem categoria caem num fallback de exatamente 2 perfis fixos, que por coincidência eram os dois CLT. O código tratava esse fallback como se fosse um resultado normal — daí o auto-preenchimento aplicar "Analista de Sistemas" como se fosse a resposta pra "Consultor SAP", sem avisar que não é uma correspondência real. **Não inventei dado de SAP/ERP** (o catálogo não tem fonte real pra isso); se o time tiver uma referência real (pesquisa salarial, histórico interno), dá pra cadastrar como categoria nova.

**Correção**: `MarketBenchmarkResult` ganhou `hasDirectMatch: boolean` — `false` quando nenhuma categoria do catálogo bateu com o cargo. Nesse caso: (1) o resumo e cada observação de fonte dizem explicitamente "não encontramos um perfil específico... referência genérica, não um benchmark direto"; (2) um aviso âmbar aparece acima da tabela de resultados; (3) o auto-preenchimento é **desativado** — nada é aplicado no formulário sem o usuário clicar "Aplicar" de propósito; (4) ao aplicar manualmente, o toast e o card "Fonte do benchmark" deixam claro que é uma "referência genérica", com o selo em amarelo (antes ficava com a mesma cor de uma correspondência real). Também ampliado o fallback de 2 pra 5 perfis, misturando CLT/PJ e senioridades (antes eram só 2 CLT) — atende o "precisamos das outras fontes" e acaba com o "CLT e CLT".

Verificado com Playwright: busca sem correspondência mostra o aviso, 5 fontes variadas (CLT e PJ), e o formulário de baixo **não muda sozinho**; aplicar manualmente rotula "referência genérica" com selo amarelo; busca com correspondência real (ex.: "Desenvolvedor Backend") continua auto-preenchendo normalmente, sem aviso.

## 2026-09-08 — Mão de obra: auto-preenchimento do benchmark, fonte dinâmica e bug de cálculo com número em formato BR

Pedidos do usuário: (1) depois de buscar um benchmark, o formulário de baixo (Perfil e composição da taxa) deveria se preencher sozinho, sem precisar clicar em "Aplicar"; (2) a taxa-hora sugerida às vezes "não batia" — pediu para testar todos os cálculos e valores; (3) a busca de benchmark deveria mostrar CLT/PJ junto com a fonte da informação.

**Bug de cálculo encontrado e corrigido**: os campos "Remuneração mensal" e "Fator K" são texto livre, e o app fazia `Number(valor)` direto no que o usuário digitasse. `Number("15.500")` (quinze mil e quinhentos, formato BR com ponto de milhar) resulta em **15.5** — 1000x menor — e `Number("1,42")` (vírgula decimal, também formato BR) resulta em `NaN`. Qualquer usuário brasileiro digitando números do jeito natural tinha o custo mensal, custo-hora e taxa sugerida silenciosamente errados, sem nenhum aviso na tela — isso explica o "não estão batendo". Corrigido com `client/src/lib/number.ts` (`parseLocaleNumber`), que interpreta tanto `"15.500"`/`"15.500,50"` (BR) quanto `"15500"`/`"1.42"` (formato simples já usado internamente) antes de calcular. Adicionado `server/tests/laborPricing.test.ts` (8 casos) testando a fórmula (`computeLaborRate`) e a rota `/labor/estimate` de ponta a ponta — confirma que a fórmula em si sempre esteve certa (`monthlyCost = salário × Fator K`, `hourlyCost = monthlyCost / 168`, `suggestedRate = hourlyCost / (1 - margem)`); o problema era só a interpretação do número digitado antes de chegar nela.

**Auto-preenchimento**: `LaborPricing` agora aplica automaticamente a primeira fonte retornada por uma busca de benchmark bem-sucedida (perfil, CLT/PJ, remuneração e Fator K), sem exigir o clique manual em "Aplicar" — que continua disponível pra escolher outra fonte quando a busca retorna mais de uma.

**Fonte dinâmica com CLT/PJ**: o card "Fonte do benchmark" mostrava um texto fixo (`"CAGED / MTE - snapshot"`) sempre, não importa qual perfil estivesse realmente aplicado. Agora mostra o regime (CLT/PJ) e o título do perfil aplicado, com a observação real da fonte (ex.: catálogo interno CAGED/MTE, ou a Portaria SGD/MGI correspondente) — só volta ao texto genérico quando nada foi aplicado ainda.

Verificado com Playwright (usuário descartável): busca de benchmark preenche o formulário sozinho; digitar "15.500" + "1,42" no formato BR gera exatamente os mesmos R$22.010 / R$131 / R$168 que os valores equivalentes em formato simples — antes desse fix, o formato BR quebrava o cálculo silenciosamente.

## 2026-09-08 — Sessão expirada não deixava mais o app preso em loop de erro 401

Pedido do usuário: testou de novo depois da correção do benchmark e essa hora achou a tela toda travada com uma sequência de `GET /api/v1/system-health 401` no console, sem nenhuma mensagem visível — o app ficava repetindo a chamada sem nunca voltar pra tela de login.

**Causa raiz**: `AuthGate` (`App.tsx`) só verifica a sessão (`checkSession()`) uma vez, no mount. Se a sessão cair *depois* disso — cookie assinado com um `SESSION_SECRET` que mudou (efêmero, gerado a cada boot quando a env var não está configurada — isso aconteceu bem provavelmente aqui, já que fiz dois deploys seguidos pouco antes do relato), expiração, ou usuário desativado — o app nunca descobre: nenhuma tela chama `checkSession()` de novo, e o polling de `/system-health` (a cada 30s) só ia acumulando 401 no console pra sempre, sem dar nenhuma pista pro usuário do que fazer.

**Correção**: novo `client/src/lib/sessionGuard.ts` intercepta toda resposta 401 vinda da API (exceto `/auth/login`, onde 401 é só "senha errada" e já tem tratamento próprio) e dispara um evento global; `AuthGate` escuta esse evento e volta pra tela de login com um toast explícito ("Sua sessão expirou. Faça login novamente."), em vez de deixar a tela girando sem explicação. Verificado com Playwright simulando o cenário real: login → navegação (sem reload) até uma tela protegida → usuário desativado no banco no meio da sessão → clique que dispara a chamada protegida → app volta pro login com o toast, confirmado por screenshot.

**Pendência que exige ação fora do código**: se `SESSION_SECRET` não estiver configurada como variável de ambiente persistente no Render (só declarada em `render.yaml` com `sync: false`, o que exige ser preenchida manualmente no painel do Render), todo deploy gera um segredo novo e desloga todo mundo sem aviso — o log do servidor grava `"SESSION_SECRET nao configurada; usando segredo efemero..."` quando isso acontece. Não tenho acesso ao painel do Render pra confirmar/corrigir isso; só o usuário pode checar e, se for o caso, definir um valor fixo lá.

## 2026-09-07 — Correção: busca de benchmark de mercado sempre "falhava" (e revisão de mensagens de erro)

Pedido do usuário: a busca de benchmark em Mão de obra dava erro toda vez ("Não foi possível buscar benchmark agora."), com uma mensagem genérica demais pra entender o motivo — pediu revisão dos tratamentos de erro/alertas do app.

**Causa raiz encontrada**: a rota `POST /market-benchmark/search` devolvia o resultado direto de `searchMarketBenchmark()` (formato `{status, source, timestamp, data, warning}`), sem passar por `toSourceView()` — o helper que toda outra rota de fonte usa pra acrescentar o campo `name`. O schema zod do cliente (`apiSourceResultSchema`) exige `name` como obrigatório, então **toda** busca falhava na validação do lado do cliente com um erro de schema, mesmo com o backend calculando e salvando o resultado com sucesso no histórico (confirmado via consulta direta no Postgres: os resultados da busca do usuário estavam lá, com o fallback estático correto). Corrigido envolvendo a resposta em `toSourceView("Benchmark salarial", result)`, igual às demais fontes. Adicionado teste de regressão (`server/tests/marketBenchmark.test.ts`) que falha se o campo `name` sumir de novo.

**Revisão de mensagens de erro**: os toasts de "Buscar benchmark" e "Atualizar fontes" (`Home.tsx`) usavam uma string de erro fixa, descartando o motivo real — trocados pelo mesmo padrão já usado em `CloudArchitect.tsx`/`AdminUsersPage.tsx` (`error: (err) => err.message`), que repassa a mensagem específica do backend quando existe (ex.: "role é obrigatório."). De quebra, achado que `onRefresh()` (refetch do react-query) nunca rejeita a Promise mesmo quando a consulta falha — o toast de "Atualizar fontes" sempre mostrava sucesso; agora verifica `isError` explicitamente antes de decidir qual toast mostrar.

**Robustez**: gravar o histórico de busca no Postgres virou fire-and-forget (não bloqueia mais a resposta) — history é acessório (só alimenta a lista da tela), não deve arriscar que uma escrita lenta no banco derrube uma resposta que já foi computada com sucesso.

Efeito colateral no mesmo fluxo: a busca do usuário aparece corretamente agora com a tabela "Fonte" por linha (catálogo interno, CAGED/MTE, etc.) — o pedido de "sempre mostrar a base de dados usada na busca" já é atendido pela tela existente, que só nunca chegava a renderizar por causa do bug acima.

## 2026-09-07 — Nomes das fontes de dados visíveis no Workspace

Pedido do usuário: mostrar quais fontes de dados a aplicação usa diretamente no menu lateral (Workspace), não só um contador — para reforçar a credibilidade dos dados (mostrar que os números vêm de integrações reais como BACEN, PNCP, AWS, Azure, GCP, e não de valores inventados).

O widget "Sistema" no rodapé do menu lateral (que já linkava para a tela "Fontes e integridade") mostrava só `"Sistema parcial" / "3 de 7 fontes online"`. Adicionado abaixo desse resumo um conjunto de selos compactos, um por fonte real (`PTAX`, `Azure`, `PNCP`, `AWS`, `GCP`, `Benchmark`, `CAGED`), cada um com o mesmo indicador de status (pontinho colorido) usado no resto do produto — verde/online, âmbar/fallback. O `title` de cada selo mostra o nome completo da fonte, o detalhe (cotação/preço) e a hora da última leitura, sem precisar abrir a tela de detalhe. Nenhuma fonte nova foi adicionada — é a mesma lista já exposta em `/system-health`, agora visível no lugar onde o usuário passa mais tempo.

Verificado com Playwright (usuário descartável): os 7 selos aparecem no widget do Workspace com a cor certa por status, sem quebrar o layout do menu lateral.

## 2026-09-07 — Dark mode em toda a aplicação

Pedido do produto: opção de tema escuro alternável, com um botão Sol/Lua no shell do app.

**Achado antes de codificar**: o `ThemeProvider`/`ThemeContext` (alterna a classe `.dark` em `<html>`, persiste em `localStorage` quando `switchable`) e um conjunto de variáveis OKLCH em `index.css` já existiam no projeto, mas nunca foram ativados nem consumidos — a UI real usa classes Tailwind com valor arbitrário e cor hardcoded (`bg-[#FBF7F1]`, `text-[#333333]`, etc.) quase em toda parte, não os tokens semânticos. Reescrever cada tela pra consumir tokens seria uma refatoração grande demais pro pedido; optado por uma camada de override que mira exatamente os seletores hardcoded já compilados pelo Tailwind.

**Implementação**: `ThemeProvider` ligado como `switchable` (`App.tsx`); botão Sol/Lua adicionado no sidebar desktop e no menu mobile (`Home.tsx`), usando `useTheme()`. Bloco `:root.dark { ... }` gerado por um script que extrai do CSS de build todas as classes `bg-`/`text-`/`border-`/`from-` com cor hex hardcoded e calcula o equivalente escuro por inversão de luminância em HSL (preserva matiz/saturação — texto escuro vira claro, fundo/borda claro vira escuro), com lista de exclusão pra cor de marca (laranja/âmbar, teal) e pras telas que são sempre escuras por design (login, troca de senha, tela de carregamento). Achado durante a verificação visual: classes com sufixo de opacidade (`bg-[#HEX]/90`) compilam num seletor Tailwind separado com o alfa já embutido no hex de 8 dígitos — não herdam o override da cor base; corrigido caso a caso (ex.: cabeçalho fixo de `Home.tsx`).

Verificado com Playwright (usuário descartável, criado e apagado na mesma sessão): alternância visual em Visão geral, Mão de obra, Licenças, Infra cloud e Administração › Usuários, e persistência da preferência após recarregar a página.

## 2026-09-07 — RBAC multiusuário: login por e-mail/senha, perfis e permissões por módulo

Pedido do produto: a aplicação tinha uma única credencial compartilhada (`TEST_ACCESS_USER`/`TEST_ACCESS_PASSWORD`, senha em texto puro numa env var, sem tabela de usuário nenhuma) e precisava evoluir pra múltiplos usuários com controle individual de acesso a Mão de obra/Infra cloud/Licenças, sem criar um perfil por combinação de módulo.

**Achado antes de codificar**: o briefing do produto presumia "existe um usuário cadastrado no banco" — não existia. A credencial antiga nunca teve persistência nem hash; era só um par de env vars comparado direto. Não dava pra "migrar" isso pra um `password_hash` por usuário sem inventar uma senha (o próprio briefing pede pra não fazer isso e sim interromper e explicar). Resolvido com um schema RBAC vazio + um script de seed (`pnpm run seed:admin`) que recebe e-mail/senha inicial do primeiro ADMIN via env var na hora de rodar — a senha é hasheada ali, nunca fica em texto puro em lugar nenhum, e esse ADMIN passa pelo mesmo fluxo de "trocar senha no primeiro login" que qualquer usuário novo.

**Modelo**: `role` (`ADMIN`/`USER`) separado de `permissions` (`LABOR`/`INFRA`/`LICENSES`), evitando perfis como `USER_LABOR_INFRA`. ADMIN nunca ganha linhas de permissão — acesso total é derivado do role, evitando a inconsistência "admin sem permissão cadastrada". Migration `0006_users_rbac.sql`: `users`, `permissions` (seed com os 3 códigos), `user_permissions` (many-to-many), `audit_logs` (schema pronto, não escrito por toda ação nesta V1 — só preparado pra não bloquear uma auditoria completa depois).

**Segurança**: senha com `crypto.scrypt` (salt aleatório + `timingSafeEqual`) — zero dependência nova, evolução do mesmo módulo `crypto` já usado pra assinar o cookie de sessão; escolhido em vez de bcrypt pra não arriscar bindings nativos quebrando no build Docker Alpine multi-stage deste projeto. Sessão evoluiu pra carregar o id do usuário (`SESSION_SECRET` novo, gera um segredo efêmero com aviso no log se não configurado, nunca a senha de ninguém). Usuário `INACTIVE` é tratado como não autenticado mesmo com cookie ainda válido — cobre desativação no meio de uma sessão aberta. **Reforço real, não só esconder menu**: o gate de permissão vive no backend (`requireAuth`/`requirePermission`/`requireRole`, `server/src/presentation/authMiddleware.ts`) — `/labor/*` e `/market-benchmark/*` exigem `LABOR`, `/cloud/*` exige `INFRA`, `/licenses/*` exige `LICENSES`; `/admin/users/*` exige `role=ADMIN`; qualquer autenticado ativo acessa `/system-health`/`/fx/ptax` (Visão Geral). Achado corrigido durante a implementação: a troca obrigatória de senha do primeiro acesso só estava sendo bloqueada no frontend — adicionado o mesmo bloqueio no `requireAuth` do backend (403 `password_change_required`), senão um usuário recém-criado conseguiria chamar a API direto sem nunca trocar a senha inicial.

**Frontend**: `AuthContext` agora carrega o usuário completo (perfil, status, permissões); menu lateral (`Home.tsx`) filtra os módulos por permissão de verdade (não é só decoração — quem não tem `INFRA` nem vê "Infra cloud" no menu, e se tentar acessar a URL direto cai numa tela "Sem acesso", com o 403 real do backend por trás). Novo item "Administração › Usuários" só pra ADMIN, com CRUD completo (criar/editar/ativar/desativar — sem exclusão física na V1) seguindo o mesmo padrão de tabela crua + modal fixo já usado no resto do produto (não introduzimos `components/ui/table.tsx`/`dialog.tsx`, que existem no projeto mas nunca foram usados em nenhuma tela real). A senha inicial só aparece em texto puro na resposta do create (com botão "Copiar senha") — depois de fechar o modal, não existe mais nenhuma forma de recuperá-la. `LoginPage` trocou o campo "Usuário" por "E-mail"; nova `ChangePasswordPage` bloqueia o app inteiro até a senha ser trocada no primeiro acesso.

**Testes** (primeira suíte automatizada do projeto — `vitest` estava instalado, nunca tinha sido usado): adicionado `supertest` (única dependência nova) pra testar as rotas de verdade contra o Postgres de desenvolvimento — 25 testes cobrindo login (certo/errado/inativo), as 3 permissões isoladas e combinadas, ADMIN com acesso total mesmo sem permissão cadastrada, 401 sem sessão, 403 sem permissão, 403 em rota admin por USER, criação de usuário, e-mail duplicado (409), ativação/desativação (com o login realmente recusando depois de desativar), e o fluxo completo de primeiro acesso (bloqueado → troca de senha → liberado). Usuários de teste isolados por domínio de e-mail dedicado e limpos no `afterAll`.

**Conflito de sessões concorrentes**: durante a implementação, outra sessão criou uma versão diferente do mesmo arquivo (`AdminUsersPage.tsx`, fetch manual em vez do padrão react-query/zod do resto do app) enquanto essa sessão trabalhava — mantida a versão consistente com o padrão já estabelecido no restante do produto (`useCloudArchitectures.ts` etc.), pra não introduzir uma segunda forma de consumir a API só nessa tela.

Verificado: `pnpm run check` limpo, `pnpm run test` com as 25 novas suítes passando contra o Postgres real, build de produção, e smoke visual com Playwright usando usuários descartáveis (criados e apagados na mesma sessão) cobrindo: ADMIN vendo todos os módulos + Administração; USER só-LABOR vendo só Mão de obra no menu; acesso direto por URL a um módulo sem permissão caindo na tela "Sem acesso".

**Pendências**: migration `0006` aplicada em produção (Supabase MCP); falta rodar `pnpm run seed:admin` com o e-mail/senha reais que o time escolher (não posso inventar) e remover `TEST_ACCESS_USER`/`TEST_ACCESS_PASSWORD` do Render depois de confirmar o primeiro login.

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
