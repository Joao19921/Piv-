# Deploy de Teste do Pivo

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

## Variaveis Opcionais

- `MARKET_BENCHMARK_CONNECTOR_URL`: conector backend para benchmark salarial ao vivo. Sem essa variavel, o sistema usa snapshot/cache com estado `FALLBACK_STALE`.

## Observacoes

- BACEN PTAX e Azure Retail Prices API nao precisam de chave.
- AWS e GCP ainda usam snapshot oficial parametrizado ate os coletores dedicados serem ligados.
- O cache local fica em `data/cache` quando o servidor roda fora de container efemero.
