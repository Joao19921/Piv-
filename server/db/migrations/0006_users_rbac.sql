-- RBAC multiusuario: substitui a credencial unica compartilhada (TEST_ACCESS_USER/PASSWORD)
-- por usuarios reais com perfil (ADMIN/USER) + permissoes individuais por modulo
-- (LABOR/INFRA/LICENSES). Nao havia tabela de usuarios antes desta migration -- a credencial
-- antiga era so um par de env vars, sem persistencia -- entao nao ha dado de usuario
-- existente pra migrar; o primeiro ADMIN e criado via `pnpm run seed:admin` (ver README).

create table users (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('ADMIN','USER')),
  status text not null check (status in ('ACTIVE','INACTIVE')) default 'ACTIVE',
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create index users_email_idx on users (email);

create table permissions (
  id bigint generated always as identity primary key,
  code text not null unique check (code in ('LABOR','INFRA','LICENSES')),
  name text not null,
  description text
);

-- ADMIN nunca ganha linhas aqui: acesso total e derivado do role, nao duplicado como
-- permissao (evita a inconsistencia "admin sem permissao cadastrada").
create table user_permissions (
  user_id bigint not null references users(id) on delete cascade,
  permission_id bigint not null references permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, permission_id)
);

-- Preparado para auditoria futura (nao escrito por toda acao nesta V1, so no login).
create table audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id bigint references users(id) on delete set null,
  target_user_id bigint references users(id) on delete set null,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on audit_logs (created_at desc);

insert into permissions (code, name, description) values
  ('LABOR', 'Mão de obra', 'Acesso ao módulo de precificação de mão de obra'),
  ('INFRA', 'Infra cloud', 'Acesso à calculadora de arquitetura cloud'),
  ('LICENSES', 'Licenças', 'Acesso ao catálogo de licenças de software');

-- RLS habilitado sem policies (mesmo padrao das demais tabelas): bloqueia acesso via
-- PostgREST/anon key; o backend conecta direto e ignora RLS.
alter table users enable row level security;
alter table permissions enable row level security;
alter table user_permissions enable row level security;
alter table audit_logs enable row level security;
