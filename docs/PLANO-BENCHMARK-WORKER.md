# Plano Incremental - Benchmark Worker

> Para regras de negócio, estado de conformidade e onde ficam credenciais/segredos,
> ver o [Manual do Benchmark Worker](BENCHMARK-WORKER-MANUAL.md) -- este documento
> aqui e' o historico fase a fase da decisao, nao a referencia operacional.

## Objetivo

Criar um modulo independente para coletar, normalizar, validar e persistir referencias
salariais de mercado. O modulo alimentara o Supabase, enquanto a aplicacao Pivo
continuara responsavel pela experiencia do usuario e pelo consumo dos dados.

Este documento registra a decisao de separar o worker da aplicacao atual e organiza a
implementacao em fases pequenas, com validacao ao final de cada etapa.

## Estado atual entendido

- A aplicacao atual usa React/Vite no frontend e Express/TypeScript no backend.
- O acesso ao Supabase ocorre pelo backend atual usando `pg`.
- Ja existem os conceitos de benchmark de busca (`market_benchmark_searches` e
  `market_benchmark_sources`) e de observacoes salariais oficiais
  (`salary_observations`).
- O benchmark atual combina catalogo estatico, CAGED/SISP e conector opcional.
- O worker novo nao deve executar dentro do Express, do frontend ou da sessao do usuario.
- Nenhuma alteracao de codigo foi feita como parte da fase de entendimento.

Referencias:

- [Arquitetura atual](ARQUITETURA.md)
- [Migrations existentes](../server/db/migrations/)
- [Servico de benchmark de mercado](../server/src/domain/services/marketBenchmark.ts)
- [Servico de observacoes salariais](../server/src/domain/services/laborBenchmark.ts)

## Limites de escopo

### O worker fara

1. Receber ou criar tarefas de coleta.
2. Consultar configuracoes seguras das fontes.
3. Executar mecanismos de acesso autorizados.
4. Extrair referencias agregadas de cargo, senioridade, localidade e remuneracao.
5. Normalizar e validar os dados.
6. Persistir resultados e historico no Supabase.
7. Registrar status, metricas basicas e erros sem dados sensiveis.

### O worker nao fara

- Procurar ou armazenar profissionais individuais.
- Alterar o fluxo de consulta da aplicacao existente.
- Executar crawler no frontend.
- Bypassar CAPTCHA, MFA, login, rate limit ou qualquer controle anti-bot.
- Armazenar senha, token, cookie ou sessao no Git, frontend ou tabelas de resultado.
- Aplicar impostos, margem, encargos ou fatores internos ao valor bruto coletado.
- Alterar migrations existentes de forma destrutiva.

## Fases de implementacao

### Fase 0 - Entendimento e decisao (concluida)

- Inspecionar a arquitetura atual, o banco e o consumo de benchmark.
- Mapear os pontos de integracao somente por dados.
- Registrar os arquivos e comportamentos que permanecem intocados.
- Confirmar que o worker sera um projeto separado.

**Saida:** este documento e a decisao de isolamento.

### Fase 1 - Analise tecnica e de conformidade (concluida com ressalvas)

- Verificar API oficial, acesso autorizado e termos de Indeed, Glassdoor e InfoJobs.
- Avaliar automacao de navegador, CAPTCHA, MFA, Google SSO, sessao e rate limits.
- Definir por fonte se a V1 usara API, exportacao autorizada, entrada manual ou adapter
  desabilitado.
- Documentar explicitamente as restricoes e os mecanismos permitidos.

**Gate:** nenhuma automacao especifica sera implementada antes desta analise.

Resultado detalhado: [Fase 1 - Analise tecnica e de conformidade](FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md).

### Fase 2 - Contrato e arquitetura do worker (concluida)

- Escolher o runtime inicial (preferencia: Python).
- Definir interfaces `Adapter`, `Extractor`, `Normalizer`, `Validator` e `Repository`.
- Definir o contrato normalizado: fonte, referencia, cargo, senioridade, UF, regime,
  faixa salarial, moeda, periodicidade, data, confianca e referencia auditavel.
- Definir timeouts, retry, isolamento de falha por fonte e logs seguros.
- Definir estrategia de execucao local, manual e agendada.

**Saida:** estrutura inicial do projeto e contratos sem acesso real as plataformas.

Resultado detalhado: [Fase 2 - Contrato e arquitetura do worker](FASE-2-ARQUITETURA-BENCHMARK-WORKER.md).

### Fase 3 - Modelo de dados isolado (concluida)

- Criar somente migrations novas para tabelas do worker:
  `benchmark_sources`, `benchmark_profiles`, `benchmark_jobs`,
  `benchmark_results` e `benchmark_runs`.
- Definir chaves, foreign keys, indices, timestamps, status e constraints de
  idempotencia.
- Habilitar RLS e limitar o acesso do worker ao necessario.
- Validar que a aplicacao atual continua lendo suas tabelas sem mudanca.

**Gate:** migration aditiva, reversivel por nova migration quando necessario e sem
alterar constraints das tabelas existentes.

Resultado detalhado: [Fase 3 - Modelo de dados isolado](FASE-3-MODELO-DE-DADOS-BENCHMARK-WORKER.md).

### Fase 4 - Nucleo executavel sem fontes reais (concluida)

- Criar o projeto `benchmark-worker/`.
- Implementar configuracao por ambiente e `.env.example`.
- Implementar job manager, scheduler, persistencia e observabilidade.
- Implementar adapters fake/fixture para exercitar o fluxo completo.
- Implementar validacao, deduplicacao e idempotencia.

**Saida:** um job de teste consegue percorrer o pipeline sem navegador real.
`PostgresRepository` persiste `benchmark_runs`/`benchmark_results` com upsert
idempotente (`on conflict (source, source_reference, observed_at)`); `catalog.py` le
`benchmark_profiles`/`benchmark_sources` do Postgres, unica fonte de verdade sobre
quais fontes estao autorizadas.

### Fase 5 - Normalizacao e testes (concluida)

- Cobrir cargos, senioridade, estados brasileiros, CLT/PJ, moeda e periodicidade.
- Cobrir faixa minima/maxima, salario mensal/anual e dados desconhecidos.
- Separar testes unitarios, integracao com banco e browser/e2e.
- Garantir que erro em uma fonte resulte em `PARTIAL`, sem impedir as demais.

**Gate:** testes unitarios e de integracao do worker passam sem depender de login real.
39 testes unitarios (`benchmark-worker/tests/`) cobrem normalizacao, validacao,
retry/isolamento e agregacao de status; um teste de integracao
(`test_integration_postgres.py`) roda contra o Postgres efemero do CI. Nenhum
adapter real existe ainda -- browser/e2e fica para a Fase 6.

### Fase 6 - Adapters por fonte, somente quando autorizados

- Implementar `IndeedAdapter`, `GlassdoorAdapter` e `InfoJobsAdapter` seguindo o
  contrato comum.
- Manter seletores e extracao separados da normalizacao.
- Desabilitar explicitamente qualquer fonte cujo acesso autorizado nao esteja disponivel.
- Nunca implementar bypass de mecanismos de seguranca.

**Saida:** cada fonte possui estado operacional claro e pode falhar isoladamente.

### Fase 7 - Execucao agendada e manual (concluida parcialmente)

- Configurar coleta automatica a cada 10 dias.
- Criar jobs pendentes no banco para futuras solicitacoes administrativas.
- Permitir que a aplicacao existente apenas solicite um job por API/banco em uma etapa
  posterior; o frontend nunca iniciara o navegador.
- Comparar Lambda, Render, GitHub Actions e outras alternativas de baixo custo antes de
  escolher o ambiente definitivo.

**Gate:** a escolha de infraestrutura deve considerar memoria, tempo de execucao,
segredos, custo e limites de automacao de navegador.

**Decisao de hospedagem:** GitHub Actions (`.github/workflows/benchmark-worker.yml`),
nao Lambda nem Render. Motivo: hoje nenhuma fonte roda navegador de verdade (todas
DISABLED, Fase 1) -- o worker so precisa de Python simples, sem Chromium. Lambda
exigiria imagem de container so para viabilizar Playwright no futuro, sem necessidade
agora; Render seria um servico pago adicional. GitHub Actions e' gratis no plano do
repo, ja e' o padrao usado para `ingest-caged.yml` e reavaliar quando/se uma fonte
real exigir automacao de navegador (nesse caso, Lambda com imagem de container ou um
runner dedicado passam a fazer sentido, pelo custo de memoria/tempo de execucao).

**Pendente:** `benchmark_jobs` (Fase 3) ainda nao e alimentada por ninguem -- a
execucao agendada hoje varre todos os `benchmark_profiles` ativos diretamente, sem
usar a tabela de jobs. Ela so passa a ser necessaria quando o admin (Fase 6/8) puder
solicitar uma coleta pontual.

### Fase 8 - Operacao e integracao futura

- Documentar runbook, secrets, alertas, retentativas e limpeza de dados.
- Expor historico de execucoes para consumo administrativo futuro.
- Validar consolidacao por fonte sem sobrescrever a origem.
- Somente apos estabilidade, definir a leitura pela aplicacao principal.

## Arquivos protegidos durante a evolucao

Enquanto as fases iniciais estiverem em andamento, nao modificar:

- `client/`
- `server/src/domain/`
- `server/src/presentation/`
- `server/src/infrastructure/`
- migrations existentes
- fluxo atual de autenticacao e benchmark

As primeiras mudancas devem ficar restritas a documentacao e, quando aprovadas, a um
novo diretorio `benchmark-worker/` e migrations novas isoladas.

## Criterio para parar antes de consumir mais recursos

Se a implementacao exigir creditos, servicos pagos, credenciais reais, acesso
autenticado ou uma decisao de arquitetura ainda nao aprovada, a fase deve parar.

Nesse caso, registrar neste documento:

- fase interrompida;
- motivo objetivo;
- o que foi concluido;
- o que falta para retomar;
- nenhum segredo ou dado autenticado.

## Proximo passo

Fases 0 a 5 e 7 concluidas (entendimento, conformidade, arquitetura, modelo de dados,
nucleo executavel, normalizacao/testes e agendamento). O worker roda a cada ~10 dias
via GitHub Actions e sempre reporta `SUCCESS` sem observacoes, porque as tres fontes
seguem `DISABLED` -- ver
[Fase 1 - Analise tecnica e de conformidade](FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md).

Investigado em 2026-09-11 (ver
[Manual, secao 3.1](BENCHMARK-WORKER-MANUAL.md#31-alternativas-legítimas-investigadas-2026-09-11)):
nenhuma API/parceria oficial pronta para uso nas tres fontes, e a maioria dos
guias salariais concorrentes e' paga/gated ou proibe reuso (Catho). Unico
caminho legitimo hoje: **entrada manual assistida** a partir de relatorios
publicos sem paywall (ex.: Robert Half) -- implementado (`manual_entry.py`,
fonte `manual` na migration `0012`), documentado no Manual, secao 3.2.

Falta:

- **Fase 6** (bloqueada): nenhum adapter real pode ser implementado sem autorizacao
  documentada de Indeed, Glassdoor ou InfoJobs. Sem isso, nao ha nada a acionar por
  este item alem de aguardar uma decisao de negocio. Vale uma consulta a Indeed
  Hiring Lab API, mas e' dado macro de tendencia, nao por cargo/senioridade --
  provavelmente nao serve como substituto direto mesmo se aprovada.
- **Fase 8** (nao iniciada): tela no admin para visualizar fontes/execucoes/erros e
  para o administrador solicitar uma coleta pontual (usaria `benchmark_jobs`, ainda
  sem consumidor). Unica etapa que tocaria `client/` -- ainda nao aprovada.
- ~~Popular `benchmark_profiles`~~ feito (migration `0013`): os mesmos 73
  cargo+senioridade que `server/src/domain/services/catalogs.ts` (laborProfiles)
  ja rastreia via CAGED/SISP, `state = null` (nacional, mesmo escopo do
  catalogo de origem). Nao inventa combinacao nova nem habilita nenhuma fonte --
  so da ao worker um alvo real para acompanhar quando `manual`/uma fonte
  autorizada gravar algo.
