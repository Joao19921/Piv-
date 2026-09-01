# Fluxos - Pivo

Este documento descreve como a solucao deve ser usada e operada no estado atual.

## 1. Saude Das Fontes

Objetivo: verificar se os numeros exibidos estao vindo de fontes ao vivo, cache ou fallback.

Fluxo:

1. Usuario acessa `Visao geral` ou `Fontes`.
2. Frontend chama `GET /api/v1/system-health`.
3. Backend consulta PTAX e Azure em paralelo.
4. Cada fonte retorna `OPERATIONAL`, `DEGRADED`, `FALLBACK_STALE` ou `OFFLINE`.
5. Frontend mostra o estado agregado e a latencia aproximada.

Regras:

- `OPERATIONAL`: fonte respondeu ao vivo.
- `DEGRADED`: houve falha ao vivo, mas cache recente respondeu.
- `FALLBACK_STALE`: sistema usou snapshot local.
- `OFFLINE`: fonte indisponivel sem alternativa suficiente.

## 2. Mao De Obra - Benchmark De Mercado

Objetivo: sugerir uma faixa salarial por cargo e localidade antes de calcular taxa-hora.

Fluxo:

1. Usuario entra em `Mao de obra`.
2. Informa cargo, UF, cidade e observacoes opcionais.
3. Frontend chama `POST /api/v1/market-benchmark/search`.
4. Backend interpreta cargo/senioridade e aplica multiplicadores regionais.
5. Resposta volta com faixa minima, mediana, maxima, fontes consideradas e status da fonte.
6. Usuario pode aplicar a remuneracao sugerida na calculadora.

Observacao: o filtro por estado/cidade existe porque remuneracao varia por regiao. Hoje a regra usa multiplicadores regionais parametrizados; com CAGED/MTE real, esse mesmo contrato pode receber dados oficiais por UF/municipio.

## 3. Mao De Obra - Taxa-Hora

Objetivo: transformar remuneracao em taxa-hora comercial.

Fluxo:

1. Usuario escolhe regime CLT ou PJ.
2. Seleciona ou valida o perfil profissional.
3. Define remuneracao mensal, Fator K e margem alvo.
4. Frontend chama `POST /api/v1/labor/estimate`.
5. Backend calcula:
   - custo mensal;
   - horas faturaveis;
   - custo/hora;
   - taxa-hora sugerida.
6. Frontend mostra o resultado com premissas e fonte do perfil.

Entradas principais:

- `monthlySalary`
- `factorK`
- `marginPct`
- `profileId`

## 4. Infra Cloud

Objetivo: estimar custo mensal de compute por provedor, regiao e SKU.

Fluxo:

1. Usuario entra em `Infra cloud`.
2. Seleciona provider (`AWS`, `Azure`, `GCP`).
3. Seleciona familia, SKU, regiao, quantidade de instancias e horas/mes.
4. Frontend chama `GET /api/v1/cloud/catalog` para montar as opcoes.
5. Frontend chama `GET /api/v1/cloud/estimate` para calcular.
6. Backend busca PTAX no BACEN e preco unitario:
   - Azure: consulta Azure Retail Prices API ao vivo.
   - AWS/GCP: usa snapshot oficial local.
7. Resposta mostra custo em USD, custo em BRL, PTAX aplicada, fonte e status.

## 5. Licencas

Objetivo: compor custo recorrente de ferramentas SaaS.

Fluxo:

1. Usuario entra em `Licencas`.
2. Filtra por categoria ou fornecedor.
3. Define quantidade de assentos por item.
4. Frontend calcula subtotal por licenca a partir do catalogo.
5. Usuario consulta fonte oficial, metrica de cobranca, ciclo e notas.

Fonte: o catalogo atual e snapshot com URLs oficiais. Para uma fase futura, cada fornecedor pode ganhar coletor ou integracao comercial propria.

## 6. Propostas

Objetivo: transformar simulacoes em premissas de proposta.

Fluxo atual:

1. Usuario calcula mao de obra, cloud e licencas.
2. Tela de propostas mostra rascunhos e pipeline visual.
3. As premissas ainda nao sao persistidas em banco.

Evolucao recomendada:

- criar entidade `Proposal`;
- persistir linhas de custo;
- guardar snapshot das fontes usadas;
- exportar PDF/CSV;
- criar aprovacao interna.

## 7. Ambiente De Teste Do Time

Objetivo: disponibilizar a aplicacao para validacao sem custo fixo.

Fluxo:

1. Repo fica no GitHub.
2. Render cria Web Service a partir de `render.yaml`.
3. Render builda o `Dockerfile`.
4. Variaveis `TEST_ACCESS_USER` e `TEST_ACCESS_PASSWORD` protegem o acesso.
5. Time acessa a URL publica do Render.

Checklist de aceite:

- `/api/v1/healthz` responde `200`.
- Tela inicial carrega.
- `Fontes` mostra PTAX/Azure em operacao ou fallback explicito.
- `Mao de obra` permite filtrar por cargo, UF e cidade.
- `Infra cloud` permite trocar provider, regiao e SKU.
- `Licencas` lista catalogo e calcula subtotal por assentos.
