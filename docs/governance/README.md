# Segurança e Governança

Este diretório concentra as regras operacionais e as evidências de segurança da solução Pivô.

## Objetivo

Manter uma referência única para:

- controles de acesso e segregação de responsabilidades;
- proteção do banco e dos dados;
- gestão de segredos e configurações;
- auditoria e observabilidade;
- migrations e mudanças de infraestrutura;
- gestão de vulnerabilidades e dependências;
- resposta a incidentes;
- backup, recuperação e continuidade;
- revisão periódica dos controles.

## Princípio arquitetural atual

```
Usuário
  ↓ HTTPS + sessão
Frontend
  ↓ API REST autenticada
Pivô / Express
  ↓ DATABASE_URL + conexão PostgreSQL
Supabase / PostgreSQL
```

O navegador não deve acessar tabelas do PostgreSQL diretamente. O backend aplica autenticação, autorização por módulo e regras de negócio antes de consultar o banco.

## Documentos

- [Security Baseline](./SECURITY.md) — controles técnicos e responsabilidades.
- [Database Security](./DATABASE-SECURITY.md) — acesso ao PostgreSQL, RLS, grants e migrations.
- [Control Matrix](./CONTROL-MATRIX.md) — controle, evidência, frequência e responsável.

## Regras

1. Segurança não é considerada concluída apenas porque uma ferramenta não apresenta alertas.
2. Ausência de evidência é registrada como **Não comprovado**, não como conformidade.
3. Mudanças estruturais no banco devem ser versionadas em `server/db/migrations/`.
4. Migration aplicada é imutável; correções devem usar uma nova migration.
5. Segredos não entram no Git; usam secrets/variáveis de ambiente.
6. Acesso direto ao banco deve ser restrito a componentes que realmente precisam dele.
7. Qualquer exceção deve registrar motivo, impacto, responsável e prazo de revisão.

## Classificação usada

- **Confirmado** — evidenciado no código, banco, CI/CD ou configuração verificada.
- **Premissa** — adotada para orientar uma decisão e que precisa ser validada se o contexto mudar.
- **Lacuna** — informação ou controle ainda não comprovado.
- **Recomendação** — melhoria proposta, ainda não requisito.
- **Risco** — condição que pode produzir impacto relevante.

## Escopo

Este diretório documenta controles técnicos da aplicação. Não substitui políticas corporativas, requisitos contratuais, avaliação jurídica, DPO/LGPD ou normas internas da organização.
