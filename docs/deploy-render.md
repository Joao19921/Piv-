# CD para o Render

O Pivô publica automaticamente no [Render](https://render.com) a cada push em `master` que passar no CI. O pipeline é: **GitHub Actions builda e valida → se passar, dispara o deploy hook do Render → Render builda a imagem Docker e publica**.

## Configuração única (manual, uma vez)

1. Crie uma conta no Render e clique em **New +** → **Blueprint**.
2. Conecte este repositório (`Joao19921/Piv-`). O Render detecta o [`render.yaml`](../render.yaml) na raiz automaticamente.
3. Na tela de revisão do Blueprint, preencha os valores dos env vars marcados como secretos (`sync: false`):
   - `TEST_ACCESS_USER` / `TEST_ACCESS_PASSWORD` — protege o ambiente publicado com Basic Auth (recomendado, já que é um ambiente de teste). Deixe em branco para publicar sem proteção.
   - `MARKET_BENCHMARK_CONNECTOR_URL` — opcional, só se houver um conector externo de benchmark salarial.
4. Confirme a criação do serviço. O primeiro deploy roda a partir do Dockerfile.
5. No serviço criado, vá em **Settings → Deploy Hook** e copie a URL (é um segredo — não a compartilhe fora do necessário).
6. No GitHub, vá em **Settings → Secrets and variables → Actions** deste repositório e crie o secret `RENDER_DEPLOY_HOOK_URL` com essa URL.

A partir daqui, todo push em `master` que passar no job `build` do CI dispara automaticamente um novo deploy no Render.

## Sem o secret configurado

Enquanto `RENDER_DEPLOY_HOOK_URL` não existir, o job `deploy` do workflow roda, detecta que o secret está vazio, imprime um aviso e sai com sucesso (não quebra o CI) — o deploy simplesmente não é disparado até você concluir os passos acima.

## Observações

- O plano `free` do Render "dorme" o serviço após um período de inatividade — a primeira requisição depois disso demora mais (cold start). Adequado para um ambiente de teste, não para produção com SLA.
- O health check do Render aponta para `/api/v1/healthz` (leve, não depende de BACEN/Azure) — não confundir com `/api/v1/system-health`, que reflete o estado real de cada fonte de dados e pode demorar alguns segundos quando alguma fonte externa está degradada.
- Para trocar de provedor (AWS App Runner, Fly.io, etc.) no futuro, o `Dockerfile` já é o artefato portável — só muda o passo de deploy do workflow.
