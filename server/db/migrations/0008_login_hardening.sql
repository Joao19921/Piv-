-- Endurecimento do login.
--
-- Ate aqui `POST /api/v1/auth/login` aceitava tentativas ilimitadas: nao havia rate limit,
-- contador de falhas nem bloqueio de conta. Um atacante com a lista de e-mails do time podia
-- testar senhas indefinidamente, e nada em lugar nenhum registrava que isso estava acontecendo.

alter table users
  -- Falhas consecutivas. Zerado a cada login bem-sucedido.
  add column failed_login_attempts integer not null default 0,
  -- Quando preenchido e no futuro, o login e recusado mesmo com a senha correta.
  add column locked_until timestamptz;

-- A tabela audit_logs existe desde a migration 0006 com o comentario "preparado para auditoria
-- futura (... so no login)", mas nunca recebeu uma unica escrita -- nem a de login. A partir
-- daqui ela e alimentada de verdade (login ok/negado, bloqueio, troca de senha e as acoes
-- administrativas sobre usuarios), entao ganha os indices que as consultas de auditoria pedem.
create index audit_logs_actor_idx on audit_logs (actor_user_id, created_at desc);
create index audit_logs_action_idx on audit_logs (action, created_at desc);
