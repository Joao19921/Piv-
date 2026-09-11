# Benchmark Worker — Manual (regras de negócio, credenciais e operação)

Documento único de referência para o módulo `benchmark-worker/`. Os documentos de
fase (`PLANO-BENCHMARK-WORKER.md`, `FASE-1-CONFORMIDADE...`,
`FASE-2-ARQUITETURA...`, `FASE-3-MODELO-DE-DADOS...`) registram o histórico de
decisão fase a fase; este aqui é o "estado atual" consolidado, para consulta
rápida sem precisar reconstruir o histórico.

## 1. O que este módulo faz

Coleta, normaliza e persiste **referências agregadas** de salário de mercado por
cargo/senioridade/UF, para alimentar o Supabase que a aplicação Pivô consome. Roda
fora do processo do Express, num projeto Python separado (`benchmark-worker/`), e
não compartilha runtime, deploy nem tabelas com a aplicação principal além das que
ele mesmo criou (`benchmark_*`, migration `0011`).

## 2. Regras de negócio (V1)

### O que é coletado

Por combinação de **cargo + senioridade + UF**:

- faixa salarial (`salary_min`, `salary_max`);
- moeda (`brl`/`usd`/`unknown`);
- periodicidade (`monthly`/`annual`/`unknown`);
- regime de contratação, **CLT e PJ mantidos separados** (nunca misturados numa
  mesma observação);
- fonte e referência auditável (`source`, `source_reference` — só o que a fonte
  permite expor, nunca cópia de página autenticada);
- data de observação e data de coleta;
- `confidence` (0.0–1.0): reduzida sempre que um campo (senioridade, UF, moeda,
  periodicidade, regime) não pôde ser reconhecido com segurança no texto da
  fonte — **nunca inventado ou inferido por adivinhação**.

### O que a V1 explicitamente não faz

- **Não aplica** impostos, margem, encargos, ajustes regionais ou qualquer fator
  interno do Pivô — o valor gravado é o benchmark bruto encontrado na fonte.
- **Não converte** periodicidade (um valor anual não vira mensal dividindo por
  12) — o dado fica exatamente como a fonte informou, com a periodicidade
  marcada.
- **Não busca nem armazena dado pessoal.** Nenhum nome, e-mail, currículo, foto
  ou identificador de uma pessoa específica passa pelo pipeline — o contrato
  normalizado (`SalaryObservation`) não tem campo para isso, e não deveria
  ganhar um.
- **Não sobrescreve uma fonte com outra.** Indeed, Glassdoor e InfoJobs
  permanecem identificáveis lado a lado (`benchmark_results.source`) — uma
  consolidação entre fontes é decisão futura da aplicação, não deste worker.
- **Não decide sozinho quando algo é desconhecido.** Senioridade, UF, moeda,
  periodicidade e regime só recebem um valor quando reconhecidos por
  palavra-chave; caso contrário ficam `unknown`/`None`, reduzindo `confidence`.

### Idempotência

Reprocessar a mesma coleta não duplica registros: a chave é
`(source, source_reference, observed_at)` (constraint `unique nulls not
distinct` em `benchmark_results`). Rodar o worker duas vezes seguidas atualiza a
mesma linha, não cria uma segunda.

### Isolamento de falha por fonte

Uma fonte instável ou sem autorização nunca impede o processamento das demais.
Uma execução (`benchmark_runs`) pode terminar `success`, `partial` ou `failed`
por fonte; o cálculo do status geral ignora fontes `DISABLED` (não é uma falha,
é um estado de conformidade esperado).

## 3. Estado de conformidade das fontes — e por que não há login a configurar

**As três fontes (Indeed, Glassdoor, InfoJobs) estão `DISABLED` hoje**, cadastro
que vive na tabela `benchmark_sources` (Postgres) — não em código, para ser a
única fonte de verdade. Motivo, registrado em
[`FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md`](FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md):
nenhuma das três tem API oficial de benchmark salarial confirmada, nem
autorização contratual para automação/scraping. Os termos de uso das três
proíbem ou não contemplam esse uso, e todas usam mecanismos anti-bot
(CAPTCHA, verificação de sessão) que este projeto está proibido de contornar —
tanto pelo plano original quanto por princípio (ver "Executando ações com
cuidado" nas instruções deste agente).

**Por isso, hoje não existe nenhum lugar para colocar e-mail e senha de uma
conta Google.** Nenhum adapter faz login em lugar nenhum — `DisabledAdapter`
levanta erro antes de qualquer tentativa de rede. Configurar uma conta Google
técnica e usá-la para autenticar um navegador automatizado contra essas
plataformas seria implementar exatamente a automação que a Fase 1 concluiu não
ser autorizada — não é uma questão de "onde guardar a senha com segurança", é
que a ação em si (login automatizado para coletar dados) ainda não tem
autorização da plataforma, independente de como a credencial seria protegida.

**O que mudaria essa resposta:** uma API oficial de alguma das três fontes, ou
um contrato/parceria explícita que autorize automação — documentado, não
presumido. Se isso acontecer para uma fonte específica:

1. Atualizar a linha correspondente em `benchmark_sources` (`status = 'enabled'`,
   `disabled_reason = null`).
2. Implementar um adapter concreto para aquela fonte (Fase 6), herdando de
   `Adapter` (não de `DisabledAdapter`) — `catalog.build_adapters` hoje recusa
   qualquer fonte `ENABLED` sem adapter real, de propósito.
3. **Só então** a questão de credencial vira relevante — e mesmo nesse cenário,
   se o mecanismo autorizado for uma API oficial (o caminho mais provável), a
   credencial é uma **API key**, não usuário/senha de uma conta Google. Ela
   entraria como um GitHub Actions Secret novo (ex.: `INDEED_API_KEY`, já
   placeholder em `benchmark-worker/.env.example`) e seria lida em
   `config.py`/no adapter novo — nunca commitada, nunca logada (ver
   `logging_utils.redact`).

## 3.1 Alternativas legítimas investigadas (2026-09-11)

Levantamento do que existe hoje, para não reabrir a mesma pergunta depois:

**Relatórios públicos agregados** (dado de cargo/senioridade/região, não de vaga
individual — categoria diferente de scraping):

| Fonte | Situação | Uso possível hoje |
|---|---|---|
| Robert Half (Guia Salarial, seção Tecnologia) | Público, **sem cadastro**, por percentil e cidade, atualizado para 2026 | Sim, como **referência manual** (ver 3.2) — sem licença explícita de reuso em massa, então citação pontual, não replicação do guia inteiro |
| Michael Page | Exige cadastro com e-mail corporativo (lead-gen) para liberar o PDF | Não automatizar — preencher o formulário só para extrair dado é o mesmo problema de autorização do scraping, disfarçado |
| Hays | PDF aparentemente gated, mesma lógica | Não automatizar |
| Catho | Termos de uso **proíbem explicitamente** copiar/armazenar/exportar conteúdo do site | Não usar como fonte, nem manualmente |
| Glassdoor | ToS: uso pessoal/não-comercial, salvo acordo separado; sem relatório agregado público para o Brasil identificado | Não aplicável |
| LinkedIn Salary Insights | Não disponível para o Brasil | Não aplicável |
| InfoJobs | Só ferramenta de consulta por vaga própria, não um guia publicado | Não aplicável |

**APIs/parcerias oficiais:**

- **Indeed Hiring Lab API** (`hiring-lab-api@indeed.com`, `docs.indeed.com/hiring-lab-api`): dados macro de tendência salarial (não por cargo/senioridade), acesso por aplicação/aprovação, cobertura do Brasil não confirmada. Vale uma consulta, mas mesmo aprovado provavelmente não substitui o benchmark por cargo que este módulo quer — é dado de tendência agregada de mercado, não de vaga/perfil.
- **Glassdoor Partner API**: fechada para novos solicitantes desde 2022, e nunca teve endpoint de salário.
- **InfoJobs**: nenhum programa de API documentado.

Nenhuma automação contra Indeed/Glassdoor/InfoJobs é viável hoje por essas vias —
a conclusão da Fase 1 continua de pé.

## 3.2 Entrada manual assistida — o caminho legítimo disponível agora

Em vez de um robô lendo a tela, **uma pessoa lê uma fonte pública legítima** (hoje,
na prática, o guia da Robert Half) **e registra o número** — a mesma
normalização/validação/deduplicação do resto do worker, sem nenhuma automação
contra uma plataforma de terceiros. Implementado em `manual_entry.py`, fonte
`benchmark_sources.name = 'manual'` (migration `0012`, `status = 'enabled'` — não
é um mecanismo de automação, então não passa pelo gate da Fase 1).

**Linha de comando** (localmente, com `BENCHMARK_WORKER_DATABASE_URL` configurado):

```
python -m benchmark_worker.cli manual-entry \
  --role "Analista de BI" \
  --seniority "Senior" \
  --state SP \
  --regime CLT \
  --salary "R$ 10.000 - R$ 15.000 por mes" \
  --reference "https://www.roberthalf.com/br/pt/insights/guia-salarial/tecnologia" \
  --observed-at 2026-09-11
```

**Pela aba Actions do GitHub** (sem precisar de Python local): workflow
"Benchmark Worker" → "Run workflow" → preencher os campos `manual_role`,
`manual_reference`, `manual_salary` (os demais são opcionais). Deixar `manual_role`
vazio dispara a coleta agendada normal em vez de um registro manual.

**Regra de uso**: `--reference` é obrigatório e é a auditoria — sempre a URL/nome
exato da página ou relatório consultado. Nunca citar aqui uma fonte da lista acima
marcada como "Não usar" (Catho) ou obtida contornando um formulário de lead-gen
(Michael Page, Hays).

## 4. Onde credenciais e segredos ficam (padrão já em uso no projeto)

| Segredo | Ambiente local | CI / execução agendada |
|---|---|---|
| `BENCHMARK_WORKER_DATABASE_URL` (conexão do worker com o Postgres) | `benchmark-worker/.env` (nunca commitado — está no `.gitignore`) | GitHub Actions Secret `BENCHMARK_WORKER_DATABASE_URL` (Settings → Secrets and variables → Actions) |
| Futura API key de uma fonte autorizada | `benchmark-worker/.env` | GitHub Actions Secret dedicado, passado como `env:` só no job que precisa dele |

Regras que já valem e continuam valendo:

- Nunca em código, nunca commitado em Git (`.gitignore` já cobre `.env`).
- Nunca no frontend — o worker não expõe nada ao `client/`.
- Nunca em log — `logging_utils.redact` oculta qualquer chave cujo nome contenha
  `password`, `senha`, `secret`, `token`, `cookie`, `session`, `api_key`,
  `authorization`, `credential`.
- A connection string do worker é **própria**, diferente da que o backend
  Express usa (`DATABASE_URL` da aplicação) — menor privilégio: o worker só
  precisa ler/escrever nas tabelas `benchmark_*`.

## 5. Arquitetura (resumo — código é a fonte de verdade)

```
benchmark-worker/src/benchmark_worker/
  domain/            contratos (Adapter/Extractor/Normalizer/Validator/Repository),
                     modelo normalizado (SalaryObservation), erros
  adapters/base.py   DisabledAdapter — todo adapter sem autorização usa esta base
  extractors/        JsonListExtractor (genérico; uma fonte real ganha o seu)
  normalization/      parsing de salário, senioridade, regime, UF
  infrastructure/     catalog.py (lê benchmark_sources/profiles do Postgres),
                     postgres_repository.py (grava benchmark_runs/results)
  runner.py           orquestra o pipeline (run_once/run_batch)
  cli.py              ponto de entrada
```

Pipeline por fonte: `Adapter.fetch → Extractor.extract → Normalizer.normalize →
Validator.validate → Repository.save_run_summary` (uma vez, ao final, para toda a
execução — ver comentário em `domain/contracts.py` sobre por que não é por
observação individual).

## 6. Banco de dados

Migration `server/db/migrations/0011_benchmark_worker_schema.sql`, aditiva, sem
alterar nenhuma tabela existente do Pivô:

- `benchmark_sources` — catálogo de fontes e status de autorização (a tabela
  citada acima). `indeed`/`glassdoor`/`infojobs` ficam `disabled`; `manual`
  (migration `0012`) fica `enabled` — não é automação, ver 3.2.
- `benchmark_profiles` — combinações cargo/senioridade/UF a monitorar. **Vazia
  hoje** — ainda não populada (ver pendências).
- `benchmark_jobs` — solicitações de coleta pontual, pensada para o admin (Fase
  6/8). **Sem consumidor ainda** — a execução agendada varre `benchmark_profiles`
  diretamente.
- `benchmark_runs` — uma linha por execução do worker, com resumo por fonte.
- `benchmark_results` — as observações normalizadas, deduplicadas por
  `(source, source_reference, observed_at)`.

RLS habilitado sem policies em todas — bloqueia acesso via PostgREST/anon key;
só a connection string própria do worker acessa.

## 7. Como rodar e testar

```
cd benchmark-worker
python -m venv .venv
. .venv/Scripts/activate        # Windows: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
python -m pytest                 # testes unitários, sem banco necessário

cp .env.example .env             # preencher BENCHMARK_WORKER_DATABASE_URL localmente
python -m benchmark_worker.cli run             # coleta agendada/em lote
python -m benchmark_worker.cli manual-entry ... # registro manual (ver 3.2)
```

## 8. Agendamento

`.github/workflows/benchmark-worker.yml`:

- `test` — a cada push/PR que toque `benchmark-worker/**` (unitários, sem banco).
- `test-integration` — idem, com Postgres efêmero (mesmo padrão do job `test` do
  `ci.yml`), valida `catalog.py`/`PostgresRepository` de ponta a ponta.
- `run` — só em agendamento (a cada ~10 dias) ou disparo manual
  (`workflow_dispatch` na aba Actions do GitHub). Não depende do deploy da
  aplicação principal nem é bloqueado por ele.

## 9. Pendências (nada aqui é urgente nem bloqueia o restante)

- **Fase 6** (adapters reais): bloqueada por autorização de negócio — sem API
  oficial ou contrato para Indeed, Glassdoor ou InfoJobs, não há o que
  implementar aqui além de aguardar.
- **Fase 8** (tela no admin): não iniciada — visualizar fontes/execuções/erros e
  permitir solicitar uma coleta pontual. É o único ponto que tocaria `client/`;
  ainda não aprovado.
- **Popular `benchmark_profiles`**: hoje vazia. O worker só processa perfis
  marcados `active`; sem popular, toda execução agendada reporta "nenhum perfil
  ativo" e não faz nada (comportamento correto, não é um bug).
