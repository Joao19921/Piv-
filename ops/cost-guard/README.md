# Trava de custo da conta AWS pessoal

Ação de governança (2026-09-13): a conta AWS que hospeda a `pivo-refresh-sources` (ingestão
periódica de preços AWS/GCP, ver `scripts/deploy-lambda.ps1`) é **pessoal**, não da empresa. Este
disjuntor existe pra garantir que um estouro de custo real (bug em loop, mudança de preço da AWS,
qualquer coisa) nunca vire uma cobrança inesperada — ele desliga a ingestão automaticamente e só
religa quando o mês vira.

## Como funciona

```
AWS Budget "pivo-personal-cost-guard" (US$ 1/mês, ACTUAL > 100%)
        │
        ├──► SNS "pivo-cost-guard-alerts" ──► Lambda "pivo-cost-guard" (index.mjs)
        │                                          │
        │                                          ├─ events:DisableRule em pivo-refresh-sources-schedule
        │                                          └─ lambda:PutFunctionConcurrency(pivo-refresh-sources, 0)
        │
        └──► e-mail (joao.henrique19921@gmail.com, joao.henrique@ctctech.com.br)

EventBridge "pivo-cost-guard-monthly-reset" (cron dia 1 de cada mês, 00:05 UTC)
        │
        └──► Lambda "pivo-cost-guard" ──► events:EnableRule + lambda:DeleteFunctionConcurrency
```

A mesma Lambda decide a ação pelo formato do evento recebido: `source: "aws.events"` +
`detail-type: "Scheduled Event"` (o reset mensal) significa religar; qualquer outro formato
(a notificação do Budget via SNS) significa desligar. Duas frentes ao desligar, de propósito:
desabilitar a regra barra a próxima execução agendada, e zerar a concorrência da função barra
qualquer outra forma de invocação (manual, reprocessamento) que apareça nesse meio-tempo.

## Recursos criados na conta (us-east-1, conta 926529379436)

- SNS: `pivo-cost-guard-alerts`
- IAM role: `pivo-cost-guard-role` (trust `lambda.amazonaws.com`, `AWSLambdaBasicExecutionRole` +
  inline `toggle-target-resources` escopada só a `pivo-refresh-sources`/`pivo-refresh-sources-schedule`)
- Lambda: `pivo-cost-guard` (Node.js 22.x, 128 MB, timeout 30s -- usa `@aws-sdk/client-eventbridge`
  e `@aws-sdk/client-lambda`, ambos providos pelo runtime gerenciado, sem bundle de dependências)
- EventBridge rule: `pivo-cost-guard-monthly-reset` (`cron(5 0 1 * ? *)`)
- AWS Budget: `pivo-personal-cost-guard` (COST, MONTHLY, limite US$ 1, notificação ACTUAL >
  100% do limite)

Testado ao vivo em 2026-09-13: invocação manual simulando o alerta do Budget desabilitou a regra
e zerou a concorrência (confirmado via `describe-rule`/`get-function`); invocação simulando o
reset mensal restaurou os dois. Estado final deixado como o normal (regra `ENABLED`, sem limite
de concorrência).

## Provisionamento

Feito manualmente via AWS CLI nesta sessão (não há script de deploy versionado, porque não é
esperado atualizar isto com frequência). A permissão usada para provisionar
(`pivo-cost-guard-setup`, política gerenciada anexada ao usuário `pivo-deploy-temp`) pode ser
removida depois de criado tudo -- o dia a dia da trava (Budget disparando, Lambda desligando/
religando) não depende dela, só usa a `pivo-cost-guard-role`.

Pra atualizar o código da Lambda no futuro: editar `index.mjs`, zipar (`Compress-Archive`) e
`aws lambda update-function-code --function-name pivo-cost-guard --zip-file fileb://function.zip
--region us-east-1` -- exige reanexar (ou nunca ter removido) a ação `lambda:UpdateFunctionCode`
sobre esse recurso.

## Ajustar o limite

`aws budgets update-budget` (ou pelo console, Billing → Budgets → `pivo-personal-cost-guard`) --
o valor de US$ 1 foi escolhido como rede de segurança (o uso real esperado é US$ 0, dentro do
Always Free Tier do Lambda), não como teto de operação normal.
