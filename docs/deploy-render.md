# Deploy No Render

Este guia publica o Pivo como um Web Service gratuito no Render usando o Dockerfile e o `render.yaml` do repositorio.

## Por Que Render

O Pivo atual roda melhor como um servidor Node/Express unico, servindo API e frontend estatico. O Render Free Web Service aceita esse modelo diretamente via Docker. Vercel e Netlify tambem possuem planos gratuitos, mas exigiriam adaptar a API Express para functions/serverless.

## Configuracao Inicial

1. Crie uma conta no Render.
2. Clique em **New +** e escolha **Blueprint**.
3. Conecte o repositorio `Joao19921/Piv-`.
4. Confirme que o Render detectou o arquivo [`../render.yaml`](../render.yaml).
5. Preencha os env vars secretos:
   - `TEST_ACCESS_USER`
   - `TEST_ACCESS_PASSWORD`
   - `MARKET_BENCHMARK_CONNECTOR_URL` somente se existir conector externo.
6. Confirme a criacao do servico.
7. Aguarde o primeiro build e deploy.

## Configuracao Esperada

O `render.yaml` define:

- service type: `web`;
- runtime: `docker`;
- plan: `free`;
- Dockerfile: `./Dockerfile`;
- health check: `/api/v1/healthz`;
- `NODE_ENV=production`.

## Acesso Do Time

Quando `TEST_ACCESS_USER` e `TEST_ACCESS_PASSWORD` estiverem definidos, o app inteiro fica protegido por Basic Auth, exceto `/api/v1/healthz`.

Compartilhe com o time:

- URL publica do Render;
- usuario de teste;
- senha de teste;
- aviso de que o primeiro acesso pode demorar se o servico estiver dormindo.

## Deploy Continuo

Use primeiro a integracao GitHub nativa do Render:

1. No servico Render, acesse **Settings**.
2. Confirme que deploy automatico esta ativo para a branch principal.
3. Cada push na branch configurada dispara um novo deploy.

Um workflow GitHub Actions pode ser adicionado depois, mas isso exige uma credencial GitHub com escopo `workflow`. No estado atual, o repositorio evita versionar `.github/workflows/ci.yml` para nao bloquear pushes feitos pelo token disponivel.

## Validacao

Depois do deploy:

```bash
curl https://pivo-i8m3.onrender.com/api/v1/healthz
```

URL real do servico em producao: `https://pivo-i8m3.onrender.com` — o Render sufixou o nome porque `pivo` sozinho ja estava em uso por outro servico de outra conta (nomes sao globais na plataforma). **Nao confundir com `pivo.onrender.com`, que nao e o nosso app.**

Resposta esperada:

```json
{ "status": "ok" }
```

Depois valide no navegador:

- tela inicial carrega;
- Basic Auth solicita usuario/senha;
- `Fontes` mostra estados reais;
- `Mao de obra` executa benchmark;
- `Infra cloud` calcula estimativa;
- `Licencas` mostra catalogo.

## Limitacoes Do Plano Gratuito

- O servico dorme apos inatividade.
- O filesystem e efemero.
- Nao ha garantia de SLA.
- Nao use para dados sensiveis de cliente.

Essas limitacoes sao aceitaveis para teste interno do time.
