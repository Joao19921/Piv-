# Matriz de Controles

| Domínio | Controle | Evidência atual | Frequência | Estado |
|---|---|---|---|---|
| Identidade | Login e sessão | Rotas de autenticação + middleware | A cada mudança | Confirmado |
| Autorização | Permissão por módulo | `requirePermission` | A cada nova rota | Confirmado |
| Banco | Sem acesso público às tabelas | Migration de security baseline | A cada migration | Confirmado |
| Banco | RLS | RLS habilitado nas tabelas existentes | A cada migration | Confirmado |
| Banco | Policies específicas | Não há policies públicas atualmente | Revisão por necessidade | Lacuna controlada |
| Migrations | Versionamento/checksum | Runner de migrations | Toda alteração | Confirmado |
| Segredos | Fora do Git | Environment/CI secrets + gitleaks | A cada PR | Confirmado |
| Dependências | Auditoria | CI `pnpm audit` | Todo PR/deploy | Confirmado |
| Observabilidade | Logs e health | Logger + health endpoints | Contínuo | Confirmado |
| Incidentes | Procedimento | `SECURITY.md` | Por incidente | Documentado |
| Backup | Restore testado | Evidência ainda não levantada neste ciclo | Periódico | Lacuna |
| Continuidade | RTO/RPO definidos | Não levantado | Periódico | Lacuna |
| Revisão de acesso | Recertificação de usuários | Processo ainda não formalizado | Mensal/trimestral a definir | Lacuna |
| Classificação de dados | Inventário formal | Parcial, precisa evolução | Periódico | Lacuna |

## Critério de aceite

Um controle só deve mudar de **Lacuna** para **Confirmado** quando houver evidência verificável no código, configuração, execução ou documentação operacional.
