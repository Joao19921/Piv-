-- Corrige um vazamento horizontal de informacao entre usuarios.
--
-- `GET /api/v1/market-benchmark/history` devolvia as 50 buscas mais recentes de TODOS os
-- usuarios para QUALQUER usuario com a permissao LABOR: a consulta era um
-- `order by generated_at desc limit 50` sem nenhum filtro, e a tabela nem tinha coluna de dono.
-- Como `notes` e texto livre, onde o analista naturalmente cola nome de cliente ou contexto da
-- negociacao, na pratica todo mundo com LABOR via para quem os outros estavam precificando.
--
-- A partir daqui cada busca tem dono e o historico e sempre filtrado por ele.
alter table market_benchmark_searches
  add column user_id bigint references users(id) on delete set null;

-- Buscas gravadas antes desta migration nao tem como ter o dono recuperado (a informacao nunca
-- foi registrada). Ficam com user_id null e, por consequencia do filtro na consulta, deixam de
-- aparecer para qualquer pessoa -- que e o comportamento correto sob a otica de privacidade:
-- na duvida sobre quem e o dono, ninguem ve. As linhas seguem no banco para nao perder
-- historico de uso agregado.
create index market_benchmark_searches_user_idx
  on market_benchmark_searches (user_id, generated_at desc);
