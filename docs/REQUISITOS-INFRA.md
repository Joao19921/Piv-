# Requisitos De Infraestrutura

Objetivo: publicar um ambiente gratuito ou sem custo fixo para testes do time, com o minimo de mudanca no codigo atual.

## Recomendacao Principal: Render Free Web Service

Recomendado para o Pivo neste momento.

Por que encaixa:

- o projeto e full-stack com um servidor Express real;
- o frontend e servido pelo mesmo processo em producao;
- o Dockerfile ja esta pronto;
- o `render.yaml` ja descreve o servico;
- nao exige adaptar a API para serverless;
- permite URL publica com TLS gerenciado;
- suporta variaveis secretas para Basic Auth.

Topologia:

```text
Usuario do time
  |
  | HTTPS + Basic Auth
  v
Render Free Web Service
  |
  |-- Express /api/v1/*
  |-- React static build
  `-- cache local efemero em data/cache
```

Recursos necessarios:

- 1 Web Service gratuito no Render;
- runtime Docker;
- porta definida por `PORT`;
- saida HTTPS para BACEN e Azure;
- sem banco obrigatorio no estado atual.

Variaveis:

| Variavel | Valor recomendado |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `PORT` | gerenciado pelo Render ou `3000` localmente |
| `TEST_ACCESS_USER` | usuario de teste do time |
| `TEST_ACCESS_PASSWORD` | senha forte compartilhada apenas internamente |
| `MARKET_BENCHMARK_CONNECTOR_URL` | vazio, ate existir conector real |
| `DATABASE_URL` | connection string do **pooler** do Postgres (Supabase, projeto `pivo`) — ver aviso de IPv4/IPv6 em "Banco De Dados" abaixo. O app web nao precisa de credencial AWS/GCP: so le precos ja gravados no Postgres pela Lambda. |

Limitacoes do plano gratuito:

- o servico pode dormir apos inatividade;
- a primeira requisicao depois do idle pode demorar;
- filesystem e efemero;
- nao ha escala horizontal;
- nao deve ser tratado como producao com SLA.

Impacto no Pivo:

- o cache em arquivo pode ser perdido, mas isso e aceitavel para teste;
- cada novo deploy pode refazer consultas de PTAX/Azure;
- propostas salvas exigirao banco em fase futura.

## Alternativas Gratuitas

| Provedor | Uso possivel | Adequacao ao Pivo atual |
| :--- | :--- | :--- |
| Render Free | Web app Node/Express com Docker | Melhor encaixe agora. |
| Netlify Free | Frontend estatico e functions | Exigiria separar/adaptar a API Express. |
| Vercel Hobby | Frontend e serverless functions | Bom para frontend, mas exigiria reempacotar rotas Express. |
| Fly.io trial | VM/container | Trial curto; ruim para teste recorrente do time. |

## Opcao 1 - Deploy Simples No Render

1. Criar conta no Render.
2. Criar novo Blueprint.
3. Conectar o repositorio GitHub.
4. Confirmar que o Render detectou `render.yaml`.
5. Configurar `TEST_ACCESS_USER` e `TEST_ACCESS_PASSWORD`.
6. Disparar o primeiro deploy.
7. Compartilhar URL, usuario e senha com o time.

Documento operacional: [deploy-render.md](deploy-render.md).

## Opcao 2 - Render Sem Blueprint

Se preferir criar manualmente:

- Service type: Web Service.
- Runtime: Docker.
- Dockerfile path: `./Dockerfile`.
- Health check path: `/api/v1/healthz`.
- Plan: Free.
- Environment:
  - `NODE_ENV=production`
  - `TEST_ACCESS_USER=...`
  - `TEST_ACCESS_PASSWORD=...`

## Banco De Dados (Supabase)

Projeto Supabase dedicado `pivo` (Postgres 17, plano free, regiao `sa-east-1`) ja criado e com o schema aplicado (`server/db/migrations/`). Cobre catalogo de cloud, precos, PTAX e historico de benchmark — ver `docs/ARQUITETURA.md`.

**Use sempre o Connection Pooler, nunca o "Direct connection".** O host direto (`db.<projeto>.supabase.co:5432`) so tem registro DNS IPv6 — testado e confirmado que Lambda (fora de VPC) falha com `getaddrinfo ENOTFOUND` nele. Use o pooler: host `aws-0-sa-east-1.pooler.supabase.com`, usuario `postgres.hiwpskashaypuvwvibds` (nao so `postgres`) — a porta muda conforme o consumidor:

- **Render**: porta `5432` (modo "Session" — recomendado para processo unico com pool de conexao de vida longa).
- **Lambda**: porta `6543` (modo "Transaction" — recomendado para uma invocacao por vez). Ja configurado assim no deploy atual.

Limitacoes do plano free do Supabase:

- o projeto pode pausar apos ~1 semana sem atividade (o cron de ingestao a cada 5 dias ajuda a manter o projeto ativo, mas nao e garantia absoluta — se pausar, o dashboard do Supabase reativa em segundos na proxima conexao);
- 500MB de storage e 2 projetos ativos simultaneos no plano free da organizacao.

### Keep-Alive Do Supabase (cron-job.org)

Para eliminar de vez o risco de pausa por inatividade (a ingestao a cada 5 dias fica proxima do limite de ~7 dias), ha um cron job gratuito e sem codigo configurado fora do repositorio, em [cron-job.org](https://cron-job.org):

- **Alvo**: `GET https://hiwpskashaypuvwvibds.supabase.co/rest/v1/` — endpoint raiz do PostgREST do projeto `pivo`. Usar a raiz (e nao uma tabela especifica) e proposital: todas as tabelas tem RLS habilitado sem policies (ver "Pendencias Arquiteturais" em [ARQUITETURA.md](ARQUITETURA.md)), entao uma chamada a uma tabela com a chave `anon` sempre voltaria vazia/negada; a raiz so precisa de uma `apikey` valida para responder `200`, o que basta para contar como atividade do projeto.
- **Header**: `apikey: <anon key do projeto>` — pegar em Supabase Dashboard > Project Settings > API > Project API keys > `anon` `public`. **Nao commitar essa chave no repositorio nem em nenhum doc**: mesmo sendo a chave publica (papel `anon`, sem acesso a nada hoje por causa do RLS acima), ela e valida para qualquer requisicao daqui a decadas e deve ser tratada como as demais credenciais deste projeto (`.env`, nunca versionado).
- **Frequencia configurada**: 1x por dia.

Isso e puramente operacional — nao ha nada para deployar; a configuracao vive so no painel do cron-job.org. Se o cron job for recriado, os dois valores acima (URL com o project ref correto e a `anon key` do projeto `pivo`, nao de outro projeto Supabase) sao os unicos que importam.

Pendente para persistir propostas, usuarios individuais e auditoria de simulacoes (proxima fase, fora do escopo desta migracao):

- entidades de dominio para `Proposal`, `CostLine` e `User`;
- migrations adicionais no mesmo projeto Supabase (ou um projeto separado, se quiser isolar o billing).

## Ingestao Periodica (Lambda + EventBridge)

A ingestao a cada ~5 dias roda como uma AWS Lambda (`pivo-refresh-sources`) disparada por um EventBridge Scheduled Rule, na conta AWS pessoal do time. Deploy/atualizacao via `scripts/deploy-lambda.ps1` (ver `docs/ARQUITETURA.md`):

1. `pnpm run build:lambda` — gera `dist-lambda/index.cjs`.
2. Definir no PowerShell: `$env:DATABASE_URL` (mesma connection string do Render) e `$env:GOOGLE_CLOUD_BILLING_API_KEY`.
3. `powershell -File scripts/deploy-lambda.ps1` — cria/atualiza a IAM Role (policy minima `pricing:GetProducts`/`pricing:DescribeServices`, sem acesso a nenhum outro recurso da conta), a funcao Lambda e o EventBridge Rule.

Nao ha access key da AWS armazenada em lugar nenhum: a Lambda autentica via a propria IAM Role de execucao. `GOOGLE_CLOUD_BILLING_API_KEY` fica salva como variavel de ambiente da funcao (Lambda criptografa em repouso por padrao).

## Segurança Do Ambiente De Teste

O Basic Auth atual e suficiente para teste fechado, desde que:

- a senha nao seja commitada;
- seja compartilhada apenas com o time;
- seja trocada ao final da fase de validacao;
- o ambiente nao seja usado para dados sensiveis de cliente.

Para producao real, substituir por:

- login por provedor corporativo;
- controle de perfis;
- auditoria;
- secrets em cofre gerenciado.

## Checklist Antes De Compartilhar A URL

- Render build concluiu com sucesso.
- `/api/v1/healthz` esta verde.
- Basic Auth esta ativo.
- Dashboard carrega no navegador.
- `Fontes` mostra estados reais.
- `Mao de obra`, `Infra cloud` e `Licencas` estao navegaveis.
- Senha de teste foi enviada por canal seguro.

## Referencias Oficiais Consultadas

- Render Free: https://render.com/docs/free
- Render first deploy: https://render.com/docs/your-first-deploy
- Vercel limits: https://vercel.com/docs/limits
- Vercel pricing: https://vercel.com/pricing
- Netlify pricing: https://www.netlify.com/pricing/
- Fly.io free trial: https://fly.io/docs/about/free-trial/
