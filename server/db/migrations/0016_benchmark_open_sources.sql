-- Catalogo das fontes ABERTAS aprovadas para registro manual (docs/BENCHMARK-WORKER-MANUAL.md,
-- secao 3.1/3.2). Antes desta migration, `benchmark_results.source_reference` aceitava
-- qualquer texto -- a tela do admin so validava "nao vazio", entao dava pra citar uma fonte
-- nunca avaliada (ex.: um guia gated ou com termos que proibem reuso).
--
-- Investigacao registrada em 2026-09-11: das fontes ja citadas na tela (Robert Half,
-- Salary.com, Mercer, Aon), so a Robert Half passa nos tres criterios (publica, sem
-- cadastro/paywall, termos que nao proibem citacao pontual). Salary.com e' o Guia Salarial de
-- Tecnologia, unica URL verificada ate agora -- novas fontes so entram aqui depois da mesma
-- verificacao de ToS, nunca digitadas livremente pelo admin.
create table benchmark_open_sources (
  name text primary key,
  label text not null,
  url text not null,
  updated_at timestamptz not null default now()
);

insert into benchmark_open_sources (name, label, url) values
  ('robert_half', 'Robert Half — Guia Salarial (Tecnologia)', 'https://www.roberthalf.com/br/pt/insights/guia-salarial/tecnologia');

-- Liga um resultado 'manual' a fonte aberta usada, sem depender de comparar string de URL.
-- Nulo para fontes que nao sao 'manual' (indeed/glassdoor/infojobs, quando um dia gravarem
-- algo, nao passam por este catalogo).
alter table benchmark_results add column open_source text references benchmark_open_sources(name);

alter table benchmark_open_sources enable row level security;
