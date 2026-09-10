# Fase 1 - Analise tecnica e de conformidade

**Status:** concluida com ressalvas  
**Data da analise:** 2026-09-09  
**Escopo:** Indeed, Glassdoor e InfoJobs  

Esta fase foi feita antes de qualquer implementacao de browser automation. Nao foram
usadas contas, credenciais, sessoes autenticadas, CAPTCHA ou scraping.

## Resultado executivo

Nenhuma das fontes foi aprovada nesta fase para crawler autenticado ou scraping
automatico. O worker deve permanecer preparado para adapters, mas cada fonte precisa
de um mecanismo autorizado e documentado antes de ser ativada.

| Fonte | Documentacao oficial localizada | API publica de salario identificada | Decisao V1 |
| :--- | :--- | :--- | :--- |
| Indeed | `docs.indeed.com` e termos legais | Nao identificada para benchmark salarial | Adapter desabilitado; somente parceria/API autorizada |
| Glassdoor | Termos oficiais de uso | Nao identificada para benchmark salarial | Adapter desabilitado; exigir acordo/autorizacao explicita |
| InfoJobs | Paginas oficiais brasileiras nao responderam de forma verificavel nesta analise | Nao confirmada | Nao implementar; solicitar canal oficial ou parecer juridico |

## Indeed

As documentacoes oficiais localizadas descrevem integrações para empregadores e
parceiros, incluindo Indeed Apply e Job Sync API. Elas nao apresentam uma API publica
para consultar faixas salariais de cargos.

Referencias:

- [Indeed Documentation](https://docs.indeed.com/)
- [Indeed Apply](https://docs.indeed.com/indeed-apply/)
- [Indeed Legal](https://www.indeed.com/legal)

Conclusao:

- nao assumir que as APIs de empregador permitem pesquisa de benchmark;
- nao automatizar login Google ou login de conta tecnica;
- nao coletar paginas por scraping;
- ativacao futura depende de parceria, API ou autorizacao contratual que cubra esse
  uso especifico.

## Glassdoor

Os termos oficiais encontrados informam que o uso comercial depende de acordo
separado quando aplicavel e que o acesso aos servicos esta sujeito aos termos
vigentes. A pagina tambem exige conta para grande parte dos servicos.

Referencia:

- [Glassdoor Terms of Use](https://www.glassdoor.com/about/terms/)

Conclusao:

- nao utilizar crawler de paginas, navegador automatizado ou coleta de salario sem
  autorizacao expressa;
- nao tentar contornar CAPTCHA, MFA, bloqueios, rate limits ou controles de sessao;
- nao usar credenciais de usuario pessoal;
- adapter permanece como contrato desabilitado ate existir acordo/API autorizada.

## InfoJobs

As URLs publicas consultadas para termos e API nao permitiram confirmar, de forma
reprodutivel, um contrato de API de benchmark salarial durante esta analise. Isso nao
deve ser interpretado como permissao para scraping.

Conclusao:

- nao implementar automacao nesta fase;
- confirmar diretamente com o canal oficial da InfoJobs se existe API, feed ou
  exportacao autorizada para dados agregados de salario;
- obter os termos aplicaveis e registrar a permissao antes de ativar o adapter.

## Regras tecnicas resultantes

1. Os adapters devem possuir estado explicito `DISABLED` quando nao houver mecanismo
   autorizado configurado.
2. O pipeline nao deve tentar fallback para scraping quando uma API falhar.
3. Login Google, MFA, CAPTCHA e sessoes nunca serao automatizados para burlar
   controles.
4. Dados pessoais, curriculos, nomes, e-mails, cookies e tokens ficam fora do modelo
   normalizado.
5. O campo de auditoria deve guardar somente referencia permitida pela fonte, sem
   copiar pagina autenticada inteira.
6. A proxima implementacao pode usar fixtures e adapters fake, mas nao deve acessar as
   tres plataformas reais.

## Pendencias para liberar uma fonte

- contrato/API oficial ou autorizacao escrita;
- escopo permitido para dados agregados de salario;
- limites de requisição e retenção;
- mecanismo de credencial em secret manager;
- responsável interno pela conta tecnica;
- revisão jurídica/compliance quando houver dúvida;
- teste de integração isolado e sem bypass de segurança.

## Gate da Fase 2

A Fase 2 pode definir os contratos internos do worker e adapters desabilitados. Ela
nao pode implementar acesso real às plataformas nem criar credenciais. A implementação
de adapters reais fica bloqueada até que pelo menos uma fonte tenha autorização
documentada.
