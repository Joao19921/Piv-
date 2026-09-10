# Plano Incremental - Benchmark Worker

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

### Fase 2 - Contrato e arquitetura do worker

- Escolher o runtime inicial (preferencia: Python).
- Definir interfaces `Adapter`, `Extractor`, `Normalizer`, `Validator` e `Repository`.
- Definir o contrato normalizado: fonte, referencia, cargo, senioridade, UF, regime,
  faixa salarial, moeda, periodicidade, data, confianca e referencia auditavel.
- Definir timeouts, retry, isolamento de falha por fonte e logs seguros.
- Definir estrategia de execucao local, manual e agendada.

**Saida:** estrutura inicial do projeto e contratos sem acesso real as plataformas.

### Fase 3 - Modelo de dados isolado

- Criar somente migrations novas para tabelas do worker:
  `benchmark_sources`, `benchmark_profiles`, `benchmark_jobs`,
  `benchmark_results` e `benchmark_runs`.
- Definir chaves, foreign keys, indices, timestamps, status e constraints de
  idempotencia.
- Habilitar RLS e limitar o acesso do worker ao necessario.
- Validar que a aplicacao atual continua lendo suas tabelas sem mudanca.

**Gate:** migration aditiva, reversivel por nova migration quando necessario e sem
alterar constraints das tabelas existentes.

### Fase 4 - Nucleo executavel sem fontes reais

- Criar o projeto `benchmark-worker/`.
- Implementar configuracao por ambiente e `.env.example`.
- Implementar job manager, scheduler, persistencia e observabilidade.
- Implementar adapters fake/fixture para exercitar o fluxo completo.
- Implementar validacao, deduplicacao e idempotencia.

**Saida:** um job de teste consegue percorrer o pipeline sem navegador real.

### Fase 5 - Normalizacao e testes

- Cobrir cargos, senioridade, estados brasileiros, CLT/PJ, moeda e periodicidade.
- Cobrir faixa minima/maxima, salario mensal/anual e dados desconhecidos.
- Separar testes unitarios, integracao com banco e browser/e2e.
- Garantir que erro em uma fonte resulte em `PARTIAL`, sem impedir as demais.

**Gate:** testes unitarios e de integracao do worker passam sem depender de login real.

### Fase 6 - Adapters por fonte, somente quando autorizados

- Implementar `IndeedAdapter`, `GlassdoorAdapter` e `InfoJobsAdapter` seguindo o
  contrato comum.
- Manter seletores e extracao separados da normalizacao.
- Desabilitar explicitamente qualquer fonte cujo acesso autorizado nao esteja disponivel.
- Nunca implementar bypass de mecanismos de seguranca.

**Saida:** cada fonte possui estado operacional claro e pode falhar isoladamente.

### Fase 7 - Execucao agendada e manual

- Configurar coleta automatica a cada 10 dias.
- Criar jobs pendentes no banco para futuras solicitacoes administrativas.
- Permitir que a aplicacao existente apenas solicite um job por API/banco em uma etapa
  posterior; o frontend nunca iniciara o navegador.
- Comparar Lambda, Render, GitHub Actions e outras alternativas de baixo custo antes de
  escolher o ambiente definitivo.

**Gate:** a escolha de infraestrutura deve considerar memoria, tempo de execucao,
segredos, custo e limites de automacao de navegador.

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

Executar somente a Fase 1, produzindo uma analise de conformidade das tres fontes.
Nenhum adapter real, migration ou alteracao na aplicacao principal deve ser feito antes
da aprovacao dessa analise.
