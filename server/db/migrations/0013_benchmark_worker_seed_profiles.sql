-- Popula benchmark_profiles com os mesmos cargo+senioridade que a aplicacao ja rastreia
-- via CAGED/SISP (server/src/domain/services/catalogs.ts, laborProfiles) -- nao inventa
-- nenhuma combinacao nova, so da ao worker um alvo real para acompanhar. `state` fica null
-- (nacional) para todas: o catalogo de origem tambem nao segmenta por UF.
--
-- Antes desta migration a tabela ficava vazia e toda execucao agendada terminava em "nenhum
-- perfil ativo" -- correto, mas sem nenhuma cobertura de fato. Isso nao habilita nenhuma
-- fonte: indeed/glassdoor/infojobs continuam disabled (Fase 1); so 'manual' (migration 0012)
-- pode gravar algo contra estes perfis por enquanto.
--
-- Idempotente: `on conflict do nothing` respeita a unique constraint
-- (role_title, seniority, state) -- rodar de novo nao duplica nem sobrescreve `active` se
-- alguem ja tiver desativado um perfil manualmente.

insert into benchmark_profiles (role_title, seniority, state) values
  ('Administrador de Dados', 'Pleno', null),
  ('Administrador de Dados', 'Sênior', null),
  ('Administrador de banco de dados', 'Júnior', null),
  ('Administrador de banco de dados', 'Pleno', null),
  ('Administrador de banco de dados', 'Sênior', null),
  ('Administrador de sistemas operacionais', 'Júnior', null),
  ('Administrador de sistemas operacionais', 'Pleno', null),
  ('Administrador de sistemas operacionais', 'Sênior', null),
  ('Administrador em seguranca da informação', 'Júnior', null),
  ('Administrador em seguranca da informação', 'Pleno', null),
  ('Administrador em seguranca da informação', 'Sênior', null),
  ('Analista de BI', 'Júnior', null),
  ('Analista de BI', 'Pleno', null),
  ('Analista de BI', 'Sênior', null),
  ('Analista de Métricas', 'Júnior', null),
  ('Analista de Métricas', 'Pleno', null),
  ('Analista de Métricas', 'Sênior', null),
  ('Analista de Negócios/Requisitos', 'Júnior', null),
  ('Analista de Negócios/Requisitos', 'Pleno', null),
  ('Analista de Negócios/Requisitos', 'Sênior', null),
  ('Analista de Sistemas', 'Pleno', null),
  ('Analista de Testes/Qualidade', 'Júnior', null),
  ('Analista de Testes/Qualidade', 'Pleno', null),
  ('Analista de Testes/Qualidade', 'Sênior', null),
  ('Analista de UX/UI', 'Pleno', null),
  ('Analista de UX/UI', 'Sênior', null),
  ('Analista de redes e de comunicação de dados', 'Júnior', null),
  ('Analista de redes e de comunicação de dados', 'Pleno', null),
  ('Analista de redes e de comunicação de dados', 'Sênior', null),
  ('Analista de sistemas de automacao', 'Júnior', null),
  ('Analista de sistemas de automacao', 'Pleno', null),
  ('Analista de sistemas de automacao', 'Sênior', null),
  ('Analista de suporte computacional', 'Júnior', null),
  ('Analista de suporte computacional', 'Pleno', null),
  ('Analista de suporte computacional', 'Sênior', null),
  ('Arquiteto de Dados', 'Júnior', null),
  ('Arquiteto de Dados', 'Pleno', null),
  ('Arquiteto de Dados', 'Sênior', null),
  ('Arquiteto de Software', 'Pleno', null),
  ('Arquiteto de Software', 'Sênior', null),
  ('Arquiteto de Soluções', 'Sênior', null),
  ('Cientista de Dados', 'Júnior', null),
  ('Cientista de Dados', 'Pleno', null),
  ('Cientista de Dados', 'Sênior', null),
  ('Desenvolvedor Backend', 'Sênior', null),
  ('Desenvolvedor Full Stack', 'Pleno', null),
  ('Desenvolvedor de Software', 'Júnior', null),
  ('Desenvolvedor de Software', 'Pleno', null),
  ('Desenvolvedor de Software', 'Sênior', null),
  ('Desenvolvedor de sistemas de tecnologia da informação', 'Júnior', null),
  ('Desenvolvedor de sistemas de tecnologia da informação', 'Pleno', null),
  ('Desenvolvedor de sistemas de tecnologia da informação', 'Sênior', null),
  ('Engenheiro de Dados', 'Especialista', null),
  ('Engenheiro de IA', 'Júnior', null),
  ('Engenheiro de IA', 'Pleno', null),
  ('Engenheiro de IA', 'Sênior', null),
  ('Especialista em Cloud', 'Pleno', null),
  ('Especialista em Cloud', 'Sênior', null),
  ('Gerente de infraestrutura de tecnologia da informação', 'Especialista', null),
  ('Gerente de projetos de tecnologia da informação', 'Especialista', null),
  ('Gerente de seguranca da informação', 'Especialista', null),
  ('Gerente de suporte técnico de tecnologia da informação', 'Especialista', null),
  ('Lider Técnico de Desenvolvimento', 'Especialista', null),
  ('Scrum Master', 'Especialista', null),
  ('Técnico de rede (telecomunicações)', 'Júnior', null),
  ('Técnico de rede (telecomunicações)', 'Pleno', null),
  ('Técnico de rede (telecomunicações)', 'Sênior', null),
  ('Técnico de suporte ao usuário de tecnologia da informação', 'Júnior', null),
  ('Técnico de suporte ao usuário de tecnologia da informação', 'Pleno', null),
  ('Técnico de suporte ao usuário de tecnologia da informação', 'Sênior', null),
  ('Técnico em manutenção de equipamentos de informática', 'Júnior', null),
  ('Técnico em manutenção de equipamentos de informática', 'Pleno', null),
  ('Técnico em manutenção de equipamentos de informática', 'Sênior', null)
on conflict (role_title, seniority, state) do nothing;
