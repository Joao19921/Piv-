# Deploy da Lambda "pivo-refresh-sources" + EventBridge Scheduled Rule (~5 dias).
#
# Pre-requisitos:
#   1. AWS CLI autenticado nesta maquina (aws configure / aws sso login).
#   2. pnpm run build:lambda  (gera dist-lambda/index.cjs)
#   3. Um arquivo .env na raiz do repo (nao versionado) com:
#        DATABASE_URL=postgresql://postgres:...@db....supabase.co:5432/postgres
#        GOOGLE_CLOUD_BILLING_API_KEY=...          (pode ficar vazia se ainda nao tiver a key)
#        SENTRY_DSN=...                            (opcional; vazio = sem error tracking na Lambda)
#      (alternativa: exportar $env:DATABASE_URL / $env:GOOGLE_CLOUD_BILLING_API_KEY / $env:SENTRY_DSN
#      manualmente antes de chamar o script, na mesma sessao)
#
# Uso:
#   pnpm run build:lambda
#   powershell -File scripts/deploy-lambda.ps1

$FunctionName = "pivo-refresh-sources"
$RoleName = "pivo-refresh-sources-role"
$RuleName = "pivo-refresh-sources-schedule"
$Region = "us-east-1"
$Schedule = "cron(0 6 1,6,11,16,21,26 * ? *)"

function Assert-LastExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Message (exit code $LASTEXITCODE)"
  }
}

# Windows PowerShell 5.1's "-Encoding utf8" grava BOM, e o AWS CLI rejeita JSON com BOM
# ("MalformedPolicyDocument: invalid Json"). Escreve UTF-8 sem BOM explicitamente.
function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

$repoRoot = Split-Path -Parent $PSScriptRoot

# Carrega .env da raiz do repo para variaveis que ainda nao estiverem definidas na sessao atual
# (nao sobrescreve $env:* ja setado manualmente).
$envFilePath = Join-Path $repoRoot ".env"
if (Test-Path $envFilePath) {
  Get-Content $envFilePath | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $key, $value = $_ -split '=', 2
    $key = $key.Trim()
    if ($key -and (-not (Test-Path "env:$key"))) {
      Set-Item -Path "env:$key" -Value $value.Trim()
    }
  }
}

if (-not $env:DATABASE_URL) {
  throw "DATABASE_URL nao encontrado (nem em `$env:DATABASE_URL nem em .env). Crie um .env na raiz do repo ou exporte a variavel antes de rodar este script."
}
# Nota: setar $env:X = "" no Windows remove a variavel (fica $null), entao usamos uma
# variavel comum (nao env:) para garantir uma string vazia de verdade no JSON abaixo —
# Lambda rejeita null como valor de env var (precisa ser string, mesmo que vazia).
$googleApiKey = if ($env:GOOGLE_CLOUD_BILLING_API_KEY) { $env:GOOGLE_CLOUD_BILLING_API_KEY } else { "" }
$sentryDsn = if ($env:SENTRY_DSN) { $env:SENTRY_DSN } else { "" }

$bundlePath = Join-Path $repoRoot "dist-lambda\index.cjs"
if (-not (Test-Path $bundlePath)) {
  throw "dist-lambda/index.cjs nao encontrado. Rode 'pnpm run build:lambda' antes."
}

Write-Host "== Identidade AWS ==" -ForegroundColor Cyan
$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
Assert-LastExitCode "Falha ao chamar 'aws sts get-caller-identity'. Rode 'aws configure' antes."
Write-Host "Conta: $($identity.Account)  |  Usuario/Role: $($identity.Arn)"
$accountId = $identity.Account

Write-Host "== IAM role ==" -ForegroundColor Cyan
$trustPolicyPath = Join-Path $env:TEMP "pivo-trust-policy.json"
$trustPolicyJson = @{
  Version = "2012-10-17"
  Statement = @(@{ Effect = "Allow"; Principal = @{ Service = "lambda.amazonaws.com" }; Action = "sts:AssumeRole" })
} | ConvertTo-Json -Depth 5
Write-Utf8NoBom -Path $trustPolicyPath -Content $trustPolicyJson

aws iam get-role --role-name $RoleName 2>$null | Out-Null
$roleExists = ($LASTEXITCODE -eq 0)

if (-not $roleExists) {
  aws iam create-role --role-name $RoleName --assume-role-policy-document "file://$trustPolicyPath" --description "Execucao da Lambda pivo-refresh-sources (ingestao de precos)" | Out-Null
  Assert-LastExitCode "Falha ao criar a IAM role $RoleName"
  aws iam attach-role-policy --role-name $RoleName --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" | Out-Null
  Assert-LastExitCode "Falha ao anexar AWSLambdaBasicExecutionRole"
  Write-Host "Role criada; aguardando propagacao (10s)..."
  Start-Sleep -Seconds 10
} else {
  Write-Host "Role $RoleName ja existe, reaproveitando."
}

$pricingPolicyPath = Join-Path $env:TEMP "pivo-pricing-policy.json"
$pricingPolicyJson = @{
  Version = "2012-10-17"
  Statement = @(@{ Effect = "Allow"; Action = @("pricing:GetProducts", "pricing:DescribeServices"); Resource = "*" })
} | ConvertTo-Json -Depth 5
Write-Utf8NoBom -Path $pricingPolicyPath -Content $pricingPolicyJson
aws iam put-role-policy --role-name $RoleName --policy-name "pricing-read-only" --policy-document "file://$pricingPolicyPath" | Out-Null
Assert-LastExitCode "Falha ao gravar a policy pricing-read-only na role"

$roleArn = (aws iam get-role --role-name $RoleName --query "Role.Arn" --output text).Trim()
Assert-LastExitCode "Falha ao ler o ARN da role $RoleName"
Write-Host "Role ARN: $roleArn"

Write-Host "== Pacote de deploy ==" -ForegroundColor Cyan
$zipPath = Join-Path $repoRoot "dist-lambda\function.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $bundlePath -DestinationPath $zipPath -CompressionLevel Optimal

$envJsonPath = Join-Path $env:TEMP "pivo-lambda-env.json"
$envVarsJson = @{
  Variables = @{
    DATABASE_URL = $env:DATABASE_URL
    GOOGLE_CLOUD_BILLING_API_KEY = $googleApiKey
    SENTRY_DSN = $sentryDsn
  }
} | ConvertTo-Json -Depth 5
Write-Utf8NoBom -Path $envJsonPath -Content $envVarsJson

Write-Host "== Lambda function ==" -ForegroundColor Cyan
aws lambda get-function --function-name $FunctionName --region $Region 2>$null | Out-Null
$functionExists = ($LASTEXITCODE -eq 0)

if ($functionExists) {
  Write-Host "Funcao ja existe; atualizando codigo e configuracao."
  aws lambda update-function-code --function-name $FunctionName --zip-file "fileb://$zipPath" --region $Region | Out-Null
  Assert-LastExitCode "Falha ao atualizar o codigo da funcao"
  aws lambda wait function-updated --function-name $FunctionName --region $Region
  aws lambda update-function-configuration --function-name $FunctionName --environment "file://$envJsonPath" --timeout 120 --memory-size 256 --region $Region | Out-Null
  Assert-LastExitCode "Falha ao atualizar a configuracao da funcao"
} else {
  # Uma role recem-criada pode demorar alguns segundos a mais para o Lambda conseguir assumi-la;
  # tenta algumas vezes antes de desistir.
  $attempts = 0
  do {
    $attempts++
    aws lambda create-function `
      --function-name $FunctionName `
      --runtime "nodejs22.x" `
      --handler "index.handler" `
      --role $roleArn `
      --zip-file "fileb://$zipPath" `
      --timeout 120 `
      --memory-size 256 `
      --environment "file://$envJsonPath" `
      --region $Region 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0 -and $attempts -lt 5) {
      Write-Host "create-function falhou (tentativa $attempts/5); aguardando propagacao da role (10s)..."
      Start-Sleep -Seconds 10
    }
  } while ($LASTEXITCODE -ne 0 -and $attempts -lt 5)
  Assert-LastExitCode "Falha ao criar a funcao Lambda $FunctionName apos $attempts tentativas"
  aws lambda wait function-active --function-name $FunctionName --region $Region
}

$lambdaArn = (aws lambda get-function --function-name $FunctionName --region $Region --query "Configuration.FunctionArn" --output text).Trim()
Assert-LastExitCode "Falha ao ler o ARN da funcao Lambda"
Write-Host "Lambda ARN: $lambdaArn"

Write-Host "== EventBridge schedule ==" -ForegroundColor Cyan
aws events put-rule --name $RuleName --schedule-expression $Schedule --region $Region | Out-Null
Assert-LastExitCode "Falha ao criar/atualizar o EventBridge rule"
aws events put-targets --rule $RuleName --region $Region --targets "Id=1,Arn=$lambdaArn" | Out-Null
Assert-LastExitCode "Falha ao associar a Lambda como target do EventBridge rule"

aws lambda add-permission `
  --function-name $FunctionName `
  --statement-id "AllowEventBridge" `
  --action "lambda:InvokeFunction" `
  --principal "events.amazonaws.com" `
  --source-arn "arn:aws:events:${Region}:${accountId}:rule/${RuleName}" `
  --region $Region 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Permissao do EventBridge ja existia (ok em re-deploy)."
}

Write-Host ""
Write-Host "Deploy concluido: $FunctionName agendada via $RuleName ($Schedule)." -ForegroundColor Green
Write-Host "Teste manual: aws lambda invoke --function-name $FunctionName --region $Region --cli-read-timeout 0 out.json; cat out.json"
