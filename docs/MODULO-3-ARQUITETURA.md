# Módulo 3: arquitetura isolada

O Módulo 3 é um deploy independente. O core não importa seus módulos, não compartilha pool de conexões e não usa as tabelas `mod3_*`. Em AWS, a API pode ser publicada como API Gateway + Lambda próprios; em homologação, o mesmo processo pode rodar como serviço separado.

```mermaid
flowchart LR
  Client[Cliente autorizado] --> Gateway[API Gateway do Módulo 3]
  Gateway --> Lambda[Lambda module3-public-data]
  Lambda --> Db[(Postgres/Supabase exclusivo MOD3_DATABASE_URL)]
  Lambda --> PNCP[API pública PNCP]
  Lambda --> Compras[API pública Compras.gov.br]
  Cron[GitHub Actions a cada 10 dias] --> Worker[Worker do Módulo 3]
  Worker --> PNCP
  Worker --> Compras
  Worker --> Db
  Core[Core de produção] -. sem dependência .- Lambda
  Core -. banco separado .- Db
```

O workflow possui `contents: read`, usa somente o segredo `MOD3_DATABASE_URL` e não executa migrations ou scripts do core. Em produção, a URL de API e o banco devem ter observabilidade e limites próprios; credenciais devem ficar em Secrets Manager ou nos secrets do ambiente, nunca no repositório.