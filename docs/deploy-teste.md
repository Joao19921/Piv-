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
  -e TEST_ACCESS_USER=pivo-teste \
  -e TEST_ACCESS_PASSWORD='defina-uma-senha-forte' \
  pivo:test
```

## Acessos de Teste

Quando `TEST_ACCESS_USER` e `TEST_ACCESS_PASSWORD` estiverem configurados em producao, o app inteiro fica protegido por Basic Auth.

Compartilhe com o time:

- URL do ambiente publicado
- usuario: valor de `TEST_ACCESS_USER`
- senha: valor de `TEST_ACCESS_PASSWORD`
- observacao: no plano gratuito, o primeiro acesso pode demorar se o servidor estiver dormindo

## Variaveis Opcionais

- `MARKET_BENCHMARK_CONNECTOR_URL`: conector backend para benchmark salarial ao vivo. Sem essa variavel, o sistema usa snapshot/cache com estado `FALLBACK_STALE`.

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
