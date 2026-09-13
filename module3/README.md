# Módulo 3: dados públicos de TI

Microsserviço independente do core. Ele não é montado por `server/index.ts`, não usa `DATABASE_URL` e só acessa o banco definido em `MOD3_DATABASE_URL`.

## Execução

```powershell
$env:MOD3_DATABASE_URL = "postgresql://..."
corepack pnpm tsx module3/src/index.ts
```

Para consultar o PNCP por São Paulo, use `/v1/mod3/public-tenders?term=desenvolvimento%20de%20software&uf=SP`. A rota oficial do PNCP é `/api/consulta/v1/contratacoes/publicacao`; `publicas` e `tam_pagina` não são os nomes válidos. O cliente repete resets de conexão, timeouts e respostas 5xx, mas não repete erros 4xx.

Para atualizar os termos configurados, execute `corepack pnpm tsx module3/src/worker.ts` com `MOD3_TERMS` separado por vírgulas. O workflow agendado roda esse comando a cada dez dias.

### Preço de referência por serviço de TI (Compras.gov.br, Pesquisa de Preço)

Substituiu a antiga integração genérica por termo livre (`searchComprasGov`/`MOD3_COMPRAS_GOV_API_URL`),
que batia numa URL configurável e nunca foi validada contra a API real -- os parâmetros e o
formato de resposta que ela esperava não existem no Compras.gov.br de verdade. A API real
(`dadosabertos.compras.gov.br`) não tem busca textual pra serviço, só por código CATSER
(`codigoItemCatalogo`); o cliente novo (`consultarPrecoServico` em `sources.ts`) bate direto
no módulo `modulo-pesquisa-preco/3_consultarServico`, sem variável de ambiente nem chave --
os códigos ficam num catálogo fixo (`catserCatalog.ts`), navegado manualmente pela hierarquia
real da API (nunca estimado).

Rotas: `GET /v1/mod3/service-price-categories` (lista as categorias do catálogo) e
`GET /v1/mod3/service-prices?categoria=<chave>` (mediana + últimos registros já persistidos
pelo worker). O `worker.ts` roda uma consulta por categoria do catálogo a cada execução
agendada, junto com o PNCP.

## Isolamento

O deploy recomendado usa uma Lambda/API Gateway ou serviço separado, uma URL de banco exclusiva e uma chave própria. Falhas, timeouts e crescimento das tabelas do Módulo 3 não compartilham processo, pool ou schema com o core. `openapi.yaml` descreve o contrato e `sql/schema.sql.txt` é aplicado somente no banco do módulo.
