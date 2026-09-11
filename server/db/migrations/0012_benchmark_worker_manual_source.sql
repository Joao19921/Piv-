-- Adiciona 'manual' como fonte valida em benchmark_sources: um humano registrando um valor
-- que leu num relatorio publico legitimo (ex.: guia salarial da Robert Half, que publica
-- faixas agregadas por cargo/senioridade/cidade sem paywall nem restricao de reuso
-- conhecida -- ver docs/BENCHMARK-WORKER-MANUAL.md, secao de fontes legitimas).
--
-- Nao e' automacao: nao ha adapter, nao ha fetch, nao ha navegador. E' a mesma acao que
-- qualquer funcionario ja poderia fazer manualmente -- so com o registro passando pela
-- mesma validacao/normalizacao/deduplicacao do restante do worker (benchmark_worker
-- manual_entry.py), em vez de uma planilha solta.
--
-- 'indeed', 'glassdoor' e 'infojobs' continuam DISABLED (Fase 1): nenhuma automacao contra
-- essas tres foi autorizada, e esta migration nao muda isso.

alter table benchmark_sources drop constraint benchmark_sources_name_check;
alter table benchmark_sources add constraint benchmark_sources_name_check
  check (name in ('indeed', 'glassdoor', 'infojobs', 'manual'));

insert into benchmark_sources (name, status, disabled_reason) values
  ('manual', 'enabled', null);
