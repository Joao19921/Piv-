# Deploy de Teste do Pivo

## Caminho Recomendado

Use Render Free Web Service com Docker. O arquivo `render.yaml` ja esta preparado para isso e o passo a passo completo esta em [deploy-render.md](deploy-render.md).

## Build local

```bash
pnpm install --frozen-lockfile
pnpm run build
NODE_ENV=production PORT=3000 node dist/index.js
```

## Docker

```bash
docker build -t pivo:test .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e SESSION_SECRET='gere-um-segredo-forte' \
  -e DATABASE_URL='postgresql://...' \
  pivo:test
```

## Acessos de Teste

Login e por e-mail/senha, com usuarios reais no Postgres (RBAC — ver [ARQUITETURA.md](ARQUITETURA.md#autorizacao-rbac)). Sem `DATABASE_URL` configurado nao ha usuarios possiveis, entao o app fica sem gate de login (mesmo comportamento de dev local sem Postgres).

Pra criar o primeiro acesso (ADMIN), rode uma vez (ver README):

```bash
ADMIN_NAME="Administrador Pivo" ADMIN_EMAIL="admin@exemplo.com" ADMIN_INITIAL_PASSWORD="defina-uma-senha-forte" pnpm run seed:admin
```

Compartilhe com o time:

- URL do ambiente publicado
- e-mail e senha inicial do usuario criado por um ADMIN em Administracao > Usuarios (o usuario e obrigado a trocar a senha no primeiro login)
- observacao: no plano gratuito, o primeiro acesso pode demorar se o servidor estiver dormindo

## Variaveis Opcionais

- `MARKET_BENCHMARK_CONNECTOR_URL`: conector backend para benchmark salarial ao vivo. Sem essa variavel, o sistema usa snapshot/cache com estado `FALLBACK_STALE`.
- `SENTRY_DSN`: ativa o envio de `logger.error(...)` para o Sentry (ver [REQUISITOS-INFRA.md](REQUISITOS-INFRA.md#observabilidade-gratuita-sentry--uptimerobot)). Sem essa variavel, os erros continuam so no log do Render, como antes.

## Checklist De Validacao

- `/api/v1/healthz` responde `200`.
- Dashboard abre apos autenticacao.
- `Fontes` lista PTAX, Azure e fontes em fallback/snapshot.
- `Mao de obra` permite selecionar perfil e filtrar benchmark por UF/cidade.
- `Infra cloud` permite selecionar provider, regiao e SKU.
- `Licencas` mostra catalogo e calcula custo por assentos.

## Observacoes

- BACEN PTAX e Azure Retail Prices API nao precisam de chave.
- AWS e GCP ainda usam snapshot oficial parametrizado ate os coletores dedicados serem ligados.
- O cache local fica em `data/cache` quando o servidor roda fora de container efemero.
