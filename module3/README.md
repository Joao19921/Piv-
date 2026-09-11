# Módulo 3: dados públicos de TI

Microsserviço independente do core. Ele não é montado por `server/index.ts`, não usa `DATABASE_URL` e só acessa o banco definido em `MOD3_DATABASE_URL`.

## Execução

```powershell
$env:MOD3_DATABASE_URL = "postgresql://..."
$env:MOD3_COMPRAS_GOV_API_URL = "https://dadosabertos.compras.gov.br/..."
corepack pnpm tsx module3/src/index.ts
```

O `MOD3_COMPRAS_GOV_API_URL` é obrigatório para habilitar a fonte, pois o Compras.gov.br mantém módulos e versões de consulta distintos. O endpoint deve ser o oficial escolhido para contratos/licitações e responder JSON com uma propriedade `data`.

Para consultar o PNCP por São Paulo, use `/v1/mod3/public-tenders?term=desenvolvimento%20de%20software&uf=SP`. A rota oficial do PNCP é `/api/consulta/v1/contratacoes/publicacao`; `publicas` e `tam_pagina` não são os nomes válidos. O cliente repete resets de conexão, timeouts e respostas 5xx, mas não repete erros 4xx.

Para atualizar os termos configurados, execute `corepack pnpm tsx module3/src/worker.ts` com `MOD3_TERMS` separado por vírgulas. O workflow agendado roda esse comando a cada dez dias.

## Isolamento

O deploy recomendado usa uma Lambda/API Gateway ou serviço separado, uma URL de banco exclusiva e uma chave própria. Falhas, timeouts e crescimento das tabelas do Módulo 3 não compartilham processo, pool ou schema com o core. `openapi.yaml` descreve o contrato e `sql/schema.sql.txt` é aplicado somente no banco do módulo.
