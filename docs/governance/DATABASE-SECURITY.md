# Segurança do Banco de Dados

## Arquitetura

O banco é consumido pelo backend Node/Express usando `DATABASE_URL` e `pg`. O frontend não utiliza Supabase Client/Data API para acessar as tabelas.

Isso permite tratar `anon` e `authenticated` como perfis sem necessidade de acesso direto ao banco.

## Baseline aplicado

A migration `20260918_security_governance_baseline.sql`:

1. habilita RLS em `schema_migrations`;
2. remove privilégios de `anon` e `authenticated` em tabelas públicas;
3. remove a view legada `salary_benchmark_current`;
4. impede privilégios padrão para novas tabelas/sequences/functions destinados a esses papéis.

## RLS x GRANT

São controles diferentes:

- **GRANT/REVOKE** define se o papel pode acessar o objeto.
- **RLS** define quais linhas podem ser acessadas quando o papel possui privilégio.

Como a aplicação atual usa o backend para falar com PostgreSQL, não há motivo para conceder acesso de tabela aos papéis da API pública.

## Observação importante

Algumas tabelas continuam com RLS habilitado sem policies específicas. Isso é intencional neste momento: o acesso público já foi retirado por `REVOKE`, e não devemos criar policies genéricas sem mapear cada caso de uso.

Se futuramente alguma tabela precisar ser acessada diretamente por Supabase Data API, deve ser criada uma policy mínima e específica, com revisão de segurança.

## Objetos especialmente protegidos

| Objeto | Tratamento |
|---|---|
| `schema_migrations` | interno; sem acesso público |
| `users` | interno; sem acesso público |
| `user_permissions` | interno; sem acesso público |
| `permissions` | interno; sem acesso público |
| `audit_logs` | interno; sem acesso público |
| `ingestion_runs` | interno; sem acesso público |
| `salary_observations` | interno; consulta pelo backend |
| `cloud_prices`, `cloud_skus`, `cloud_regions`, `fx_rates`, `storage_prices` | consulta pelo backend |
| `market_benchmark_*` | legado; acesso direto bloqueado; remoção futura depende de confirmação de uso |

## Mudanças de banco

Toda alteração estrutural deve:

- entrar em uma nova migration;
- ser idempotente quando possível;
- ser aplicada primeiro em ambiente descartável/homologação;
- passar por CI;
- ser aplicada em produção pelo pipeline;
- ser validada após deploy;
- manter evidência do resultado.

Nunca editar uma migration já aplicada.
