# Security Baseline

## 1. Controles confirmados

| Controle | Implementação | Evidência |
|---|---|---|
| Autenticação | Sessão no backend | `server/src/presentation/authRoutes.ts`, `authMiddleware.ts` |
| Autorização | Permissões por módulo | `requirePermission()` nas rotas |
| Banco atrás da API | Frontend usa cliente HTTP; backend usa `pg` | `client/src/lib/api.ts`, `server/src/infrastructure/db/client.ts` |
| TLS banco | Suportado via `DATABASE_CA_CERT`; fallback atual pode operar cifrado sem validação de identidade | `server/src/infrastructure/db/client.ts` |
| Segredos | Variáveis de ambiente | `.env.example`, CI/CD |
| Auditoria | Tabela `audit_logs` | PostgreSQL |
| Observabilidade | Logger, Sentry e health checks | `server/src/infrastructure/observability/` |
| Dependências | Dependabot + `pnpm audit` no CI | `.github/workflows/ci.yml` |
| Segredos no Git | gitleaks no CI | `.github/workflows/ci.yml` |
| Migrations versionadas | SQL + checksum | `server/db/migrations/`, `server/scripts/migrate.ts` |

## 2. Controles aplicados em 2026-09-18

### Banco

- `public.schema_migrations`: RLS habilitado e acesso de `anon`/`authenticated` revogado.
- `public.salary_benchmark_current`: view removida por não ser dependência do fluxo atual.
- Acesso de `anon`/`authenticated` a tabelas do schema `public`: revogado.
- Privilégios padrão para novas tabelas, sequences e functions: revogados para `anon`/`authenticated`.

Migration:
`server/db/migrations/20260918_security_governance_baseline.sql`

## 3. Modelo de confiança

**Usuário → sessão → autorização → API → banco**

O usuário não recebe credenciais de banco e não deve consultar diretamente tabelas internas como usuários, permissões, auditoria, ingestões ou observações salariais.

## 4. Controles que precisam de revisão periódica

- permissões de usuários;
- contas administrativas;
- dependências com vulnerabilidades;
- secrets e certificados;
- backups e restauração;
- exposição de novas rotas;
- grants/RLS após novas migrations;
- logs e dados potencialmente sensíveis;
- fontes externas e credenciais de ingestão.

## 5. Incidente

Em caso de incidente:

1. identificar escopo e componente afetado;
2. preservar logs/evidências;
3. bloquear ou revogar credenciais comprometidas;
4. reduzir exposição antes de corrigir;
5. corrigir e testar;
6. validar recuperação;
7. registrar causa, impacto, ação corretiva e ação preventiva.

## 6. Limites

Este baseline não declara conformidade legal ou certificação. LGPD, contratos, políticas corporativas e requisitos de clientes devem ser avaliados separadamente quando aplicáveis.
