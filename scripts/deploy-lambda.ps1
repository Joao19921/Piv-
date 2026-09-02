# Deploy da Lambda "pivo-refresh-sources" + EventBridge Scheduled Rule (~5 dias).
#
# Pre-requisitos:
#   1. AWS CLI autenticado nesta maquina (aws configure / aws sso login).
#   2. pnpm run build:lambda  (gera dist-lambda/index.cjs)
#   3. Variaveis de ambiente definidas nesta sessao do PowerShell:
#        $env:DATABASE_URL = "postgresql://postgres:...@db....supabase.co:5432/postgres"
#        $env:GOOGLE_CLOUD_BILLING_API_KEY = "..."   (pode ficar vazia se ainda nao tiver a key)
#
# Uso:
#   pnpm run build:lambda
#   powershell -File scripts/deploy-lambda.ps1

$ErrorActionPreference = "Stop"

$FunctionName = "pivo-refresh-sources"
$RoleName = "pivo-refresh-sources-role"
$RuleName = "pivo-refresh-sources-schedule"
$Region = "us-east-1"
$Schedule = "cron(0 6 1,6,11,16,21,26 * ? *)"

if (-not $env:DATABASE_URL) {
  throw "Defina `$env:DATABASE_URL antes de rodar este script."
}
if ($null -eq $env:GOOGLE_CLOUD_BILLING_API_KEY) {
  $env:GOOGLE_CLOUD_BILLING_API_KEY = ""
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$bundlePath = Join-Path $repoRoot "dist-lambda\index.cjs"
if (-not (Test-Path $bundlePath)) {
  throw "dist-lambda/index.cjs nao encontrado. Rode 'pnpm run build:lambda' antes."
}

Write-Host "== Identidade AWS ==" -ForegroundColor Cyan
$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
Write-Host "Conta: $($identity.Account)  |  Usuario/Role: $($identity.Arn)"
$accountId = $identity.Account

Write-Host "== IAM role ==" -ForegroundColor Cyan
$trustPolicyPath = Join-Path $env:TEMP "pivo-trust-policy.json"
@{
  Version = "2012-10-17"
  Statement = @(@{ Effect = "Allow"; Principal = @{ Service = "lambda.amazonaws.com" }; Action = "sts:AssumeRole" })
} | ConvertTo-Json -Depth 5 | Set-Content -Path $trustPolicyPath -Encoding utf8

$roleExists = $true
try { aws iam get-role --role-name $RoleName | Out-Null } catch { $roleExists = $false }

if (-not $roleExists) {
  aws iam create-role --role-name $RoleName --assume-role-policy-document "file://$trustPolicyPath" --description "Execucao da Lambda pivo-refresh-sources (ingestao de precos)" | Out-Null
  aws iam attach-role-policy --role-name $RoleName --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" | Out-Null
  Write-Host "Role criada; aguardando propagacao (10s)..."
  Start-Sleep -Seconds 10
} else {
  Write-Host "Role $RoleName ja existe, reaproveitando."
}

$pricingPolicyPath = Join-Path $env:TEMP "pivo-pricing-policy.json"
@{
  Version = "2012-10-17"
  Statement = @(@{ Effect = "Allow"; Action = @("pricing:GetProducts", "pricing:DescribeServices"); Resource = "*" })
} | ConvertTo-Json -Depth 5 | Set-Content -Path $pricingPolicyPath -Encoding utf8
aws iam put-role-policy --role-name $RoleName --policy-name "pricing-read-only" --policy-document "file://$pricingPolicyPath" | Out-Null

$roleArn = (aws iam get-role --role-name $RoleName --query "Role.Arn" --output text).Trim()
Write-Host "Role ARN: $roleArn"

Write-Host "== Pacote de deploy ==" -ForegroundColor Cyan
$zipPath = Join-Path $repoRoot "dist-lambda\function.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $bundlePath -DestinationPath $zipPath -CompressionLevel Optimal

$envJsonPath = Join-Path $env:TEMP "pivo-lambda-env.json"
@{
  Variables = @{
    DATABASE_URL = $env:DATABASE_URL
    GOOGLE_CLOUD_BILLING_API_KEY = $env:GOOGLE_CLOUD_BILLING_API_KEY
  }
} | ConvertTo-Json -Depth 5 | Set-Content -Path $envJsonPath -Encoding utf8

Write-Host "== Lambda function ==" -ForegroundColor Cyan
$functionExists = $true
try { aws lambda get-function --function-name $FunctionName --region $Region | Out-Null } catch { $functionExists = $false }

if ($functionExists) {
  Write-Host "Funcao ja existe; atualizando codigo e configuracao."
  aws lambda update-function-code --function-name $FunctionName --zip-file "fileb://$zipPath" --region $Region | Out-Null
  aws lambda wait function-updated --function-name $FunctionName --region $Region
  aws lambda update-function-configuration --function-name $FunctionName --environment "file://$envJsonPath" --timeout 120 --memory-size 256 --region $Region | Out-Null
} else {
  aws lambda create-function `
    --function-name $FunctionName `
    --runtime "nodejs22.x" `
    --handler "index.handler" `
    --role $roleArn `
    --zip-file "fileb://$zipPath" `
    --timeout 120 `
    --memory-size 256 `
    --environment "file://$envJsonPath" `
    --region $Region | Out-Null
  aws lambda wait function-active --function-name $FunctionName --region $Region
}

$lambdaArn = (aws lambda get-function --function-name $FunctionName --region $Region --query "Configuration.FunctionArn" --output text).Trim()
Write-Host "Lambda ARN: $lambdaArn"

Write-Host "== EventBridge schedule ==" -ForegroundColor Cyan
aws events put-rule --name $RuleName --schedule-expression $Schedule --region $Region | Out-Null
aws events put-targets --rule $RuleName --region $Region --targets "Id=1,Arn=$lambdaArn" | Out-Null

try {
  aws lambda add-permission `
    --function-name $FunctionName `
    --statement-id "AllowEventBridge" `
    --action "lambda:InvokeFunction" `
    --principal "events.amazonaws.com" `
    --source-arn "arn:aws:events:${Region}:${accountId}:rule/${RuleName}" `
    --region $Region | Out-Null
} catch {
  Write-Host "Permissao do EventBridge ja existia (ok em re-deploy)."
}

Write-Host ""
Write-Host "Deploy concluido: $FunctionName agendada via $RuleName ($Schedule)." -ForegroundColor Green
Write-Host "Teste manual: aws lambda invoke --function-name $FunctionName --region $Region --cli-read-timeout 0 out.json; cat out.json"
