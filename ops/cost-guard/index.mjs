// Lambda "disjuntor" de custo, fora do app principal -- governanca da conta AWS pessoal.
//
// Gatilhos:
//  - AWS Budgets (via SNS): a Budget "pivo-personal-cost-guard" publica no topico
//    pivo-cost-guard-alerts quando o gasto ACTUAL do mes atinge 100% do limite. Qualquer evento
//    que nao seja o reset agendado abaixo e tratado como estouro de custo -> desliga.
//  - EventBridge agendado (pivo-cost-guard-monthly-reset, dia 1 de cada mes): religa.
//
// Acao de desligar = duas frentes, de proposito (uma so nao cobre todo caminho de invocacao):
//  1. events:DisableRule na regra que dispara a pivo-refresh-sources a cada 5 dias -- impede
//     a proxima execucao agendada.
//  2. lambda:PutFunctionConcurrency(0) na propria pivo-refresh-sources -- barra qualquer
//     invocacao (manual, reprocessamento, outro gatilho futuro) enquanto o mes nao vira, mesmo
//     que alguem reative a regra sem querer.
import { EventBridgeClient, DisableRuleCommand, EnableRuleCommand } from "@aws-sdk/client-eventbridge";
import { LambdaClient, PutFunctionConcurrencyCommand, DeleteFunctionConcurrencyCommand } from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION || "us-east-1";
const TARGET_FUNCTION = process.env.TARGET_FUNCTION_NAME || "pivo-refresh-sources";
const TARGET_RULE = process.env.TARGET_RULE_NAME || "pivo-refresh-sources-schedule";

const eventsClient = new EventBridgeClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });

async function stop() {
  await eventsClient.send(new DisableRuleCommand({ Name: TARGET_RULE }));
  await lambdaClient.send(new PutFunctionConcurrencyCommand({ FunctionName: TARGET_FUNCTION, ReservedConcurrentExecutions: 0 }));
  console.log(`Trava de custo ACIONADA: regra ${TARGET_RULE} desabilitada e ${TARGET_FUNCTION} com concurrency=0.`);
}

async function resume() {
  await eventsClient.send(new EnableRuleCommand({ Name: TARGET_RULE }));
  await lambdaClient.send(new DeleteFunctionConcurrencyCommand({ FunctionName: TARGET_FUNCTION }));
  console.log(`Trava de custo LIBERADA: regra ${TARGET_RULE} reabilitada e concurrency de ${TARGET_FUNCTION} restaurada.`);
}

export const handler = async (event) => {
  const isMonthlyReset = event?.source === "aws.events" && event?.["detail-type"] === "Scheduled Event";
  if (isMonthlyReset) {
    await resume();
    return { action: "resume" };
  }
  await stop();
  return { action: "stop", trigger: event };
};
