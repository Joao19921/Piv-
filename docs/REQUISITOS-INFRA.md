# Requisitos De Infraestrutura

Objetivo: publicar um ambiente gratuito ou sem custo fixo para testes do time, com o minimo de mudanca no codigo atual.

## Recomendacao Principal: Render Free Web Service

Recomendado para o Pivo neste momento.

Por que encaixa:

- o projeto e full-stack com um servidor Express real;
- o frontend e servido pelo mesmo processo em producao;
- o Dockerfile ja esta pronto;
- o `render.yaml` ja descreve o servico;
- nao exige adaptar a API para serverless;
- permite URL publica com TLS gerenciado;
- suporta variaveis secretas para Basic Auth.

Topologia:

```text
Usuario do time
  |
  | HTTPS + Basic Auth
  v
Render Free Web Service
  |
  |-- Express /api/v1/*
  |-- React static build
  `-- cache local efemero em data/cache
```

Recursos necessarios:

- 1 Web Service gratuito no Render;
- runtime Docker;
- porta definida por `PORT`;
- saida HTTPS para BACEN e Azure;
- sem banco obrigatorio no estado atual.

Variaveis:

| Variavel | Valor recomendado |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `PORT` | gerenciado pelo Render ou `3000` localmente |
| `TEST_ACCESS_USER` | usuario de teste do time |
| `TEST_ACCESS_PASSWORD` | senha forte compartilhada apenas internamente |
| `MARKET_BENCHMARK_CONNECTOR_URL` | vazio, ate existir conector real |

Limitacoes do plano gratuito:

- o servico pode dormir apos inatividade;
- a primeira requisicao depois do idle pode demorar;
- filesystem e efemero;
- nao ha escala horizontal;
- nao deve ser tratado como producao com SLA.

Impacto no Pivo:

- o cache em arquivo pode ser perdido, mas isso e aceitavel para teste;
- cada novo deploy pode refazer consultas de PTAX/Azure;
- propostas salvas exigirao banco em fase futura.

## Alternativas Gratuitas

| Provedor | Uso possivel | Adequacao ao Pivo atual |
| :--- | :--- | :--- |
| Render Free | Web app Node/Express com Docker | Melhor encaixe agora. |
| Netlify Free | Frontend estatico e functions | Exigiria separar/adaptar a API Express. |
| Vercel Hobby | Frontend e serverless functions | Bom para frontend, mas exigiria reempacotar rotas Express. |
| Fly.io trial | VM/container | Trial curto; ruim para teste recorrente do time. |

## Opcao 1 - Deploy Simples No Render

1. Criar conta no Render.
2. Criar novo Blueprint.
3. Conectar o repositorio GitHub.
4. Confirmar que o Render detectou `render.yaml`.
5. Configurar `TEST_ACCESS_USER` e `TEST_ACCESS_PASSWORD`.
6. Disparar o primeiro deploy.
7. Compartilhar URL, usuario e senha com o time.

Documento operacional: [deploy-render.md](deploy-render.md).

## Opcao 2 - Render Sem Blueprint

Se preferir criar manualmente:

- Service type: Web Service.
- Runtime: Docker.
- Dockerfile path: `./Dockerfile`.
- Health check path: `/api/v1/healthz`.
- Plan: Free.
- Environment:
  - `NODE_ENV=production`
  - `TEST_ACCESS_USER=...`
  - `TEST_ACCESS_PASSWORD=...`

## Quando Adicionar Banco

O banco nao e necessario para o teste atual, mas passa a ser necessario quando houver:

- propostas persistidas;
- usuarios individuais;
- auditoria de simulacoes;
- historico permanente de benchmark;
- catalogos versionados;
- pipeline real de CAGED/PNCP.

Sugestao de fase 2:

- Postgres gerenciado em plano gratuito ou baixo custo;
- migrations versionadas;
- repositorios em `server/src/infrastructure/repositories`;
- entidades de dominio para `Proposal`, `CostLine`, `DataSnapshot` e `User`.

## Segurança Do Ambiente De Teste

O Basic Auth atual e suficiente para teste fechado, desde que:

- a senha nao seja commitada;
- seja compartilhada apenas com o time;
- seja trocada ao final da fase de validacao;
- o ambiente nao seja usado para dados sensiveis de cliente.

Para producao real, substituir por:

- login por provedor corporativo;
- controle de perfis;
- auditoria;
- secrets em cofre gerenciado.

## Checklist Antes De Compartilhar A URL

- Render build concluiu com sucesso.
- `/api/v1/healthz` esta verde.
- Basic Auth esta ativo.
- Dashboard carrega no navegador.
- `Fontes` mostra estados reais.
- `Mao de obra`, `Infra cloud` e `Licencas` estao navegaveis.
- Senha de teste foi enviada por canal seguro.

## Referencias Oficiais Consultadas

- Render Free: https://render.com/docs/free
- Render first deploy: https://render.com/docs/your-first-deploy
- Vercel limits: https://vercel.com/docs/limits
- Vercel pricing: https://vercel.com/pricing
- Netlify pricing: https://www.netlify.com/pricing/
- Fly.io free trial: https://fly.io/docs/about/free-trial/
