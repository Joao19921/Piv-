# PRD Original — Arquitetura Aspiracional (histórico)

> Documento preservado como referência histórica. Descreve a arquitetura **originalmente proposta** para o Pivô, antes de qualquer implementação — em Python/FastAPI, com Clean Architecture, coletores independentes e servidor MCP. A implementação real seguiu outro caminho (Node/TypeScript sobre a base já existente); veja [`ARQUITETURA.md`](ARQUITETURA.md) para o que foi de fato construído e por quê.

---

## 📋 Sumário Executivo

Este documento especifica a arquitetura end-to-end de uma plataforma de **Precificação Estratégica para Soluções de TI**. A solução automatiza a coleta, normalização, enriquecimento e exibição de dados de custo de **mão de obra (CAGED/MTE/PNCP)**, **serviços de infraestrutura cloud (AWS, Azure, GCP)**, **cotações de moedas em tempo real (BACEN)** e **contratos/licitações de software (PNCP)**.

---

## 📐 Padrões e Princípios de Arquitetura

| Camada / Domínio | Padrão Arquitetural / Princípio | Descrição & Justificativa |
| :--- | :--- | :--- |
| **Backend / Domínio** | **Clean Architecture & Domain-Driven Design (DDD)** | Desacoplamento total entre regras de negócio (cálculo de Fator K, taxas horárias PJ/CLT) e detalhes de infraestrutura (banco de dados, APIs externas). |
| **Frontend UI** | **Component-Driven Architecture (CDA) & Feature-First Structure** | Interface dividida em componentes reutilizáveis e isolados por contexto/funcionalidade, priorizando acessibilidade e modularidade. |
| **Resiliência e Tolerância a Falhas** | **Circuit Breaker, Retry with Exponential Backoff & Fallback Strategies** | Isolamento de integrações externas para evitar falhas em cascata no sistema e garantir operabilidade mesmo offline/com degraded state. |
| **Comunicação / Integração** | **RESTful APIs + MCP (Model Context Protocol)** | Interface tradicional via HTTP/JSON para a aplicação web e protocolo MCP para assistentes de IA (Cursor/VSCode/LLMs) consumirem as ferramentas de precificação. |
| **Padrão de Ingestão de Dados** | **Pipeline ELT (Extract, Load, Transform) Assíncrono** | Coleta periódica de dados via tarefas agendadas e tratamento desacoplado para tabelas analíticas. |

---

## 🏗️ Visão Geral da Arquitetura do Sistema (proposta)

```text
                                  +-------------------------------------------------------+
                                  |                 CAMADA FRONT-END                      |
                                  |   React + TypeScript + Tailwind CSS + shadcn/ui       |
                                  |   State Management: TanStack Query (React Query)      |
                                  +---------------------------+---------------------------+
                                                              |
                                                    (HTTPS / REST APIs)
                                                              v
+-----------------------------------------------------------------------------------------------------------------+
|                                               CAMADA BACKEND & API                                              |
|                                        FastAPI / Python (Clean Architecture)                                    |
|                                                                                                                 |
|  +---------------------------+  +-------------------------------+  +-----------------------------------------+  |
|  |    FastAPI REST Gateway   |  |     Engine de Precificação    |  |               MCP Server                |  |
|  | (Auth, Orçamentos, Cache) |  | (Fator K, Margem, Taxa Hora)  |  | (FastMCP p/ Integração com IA / IDEs)   |  |
|  +-------------+-------------+  +---------------+---------------+  +--------------------+--------------------+  |
+----------------|--------------------------------|-----------------------------------|-------------------+
                 |                                |                                   |
                 +--------------------------------+-----------------------------------+
                                                  |
                                                  v
+-----------------------------------------------------------------------------------------------------------------+
|                                        CAMADA DE INTEGRACAO E RESILIÊNCIA                                       |
|                            Resilience Engine (Resilience4j / Tenacity & PyBreaker)                              |
|                                                                                                                 |
|   +-------------------+   +--------------------+   +---------------------+   +--------------------------+   |
|   | AWS Pricing Extr. |   | Azure Price Extr.  |   | BACEN PTAX Extractor|   | PNCP / CAGED Data Extr.  |   |
|   +---------+---------+   +---------+----------+   +----------+----------+   +------------+-------------+   |
|             |                       |                         |                           |                 |
|    Circuit Breaker /        Circuit Breaker /        Circuit Breaker /           Circuit Breaker /          |
|    Retry / Cache Stale      Retry / Cache Stale      Retry / Fallback PTAX      Retry / Fallback Parquet    |
+-------------|-----------------------|-------------------------|---------------------------|-----------------+
              v                       v                         v                           v
     [ AWS Price API ]       [ Azure Retail API ]      [ BACEN Olinda API ]       [ Compras.gov / PNCP API ]
```

---

## 📂 Estrutura de Diretórios Proposta (monorepo Python + React)

```text
pricing-engine-monorepo/
├── apps/
│   ├── web/                         # FRONTEND (React + Tailwind CSS + shadcn/ui)
│   └── api/                         # BACKEND (Python FastAPI + Clean Architecture)
│       ├── src/
│       │   ├── domain/              # Regras de Negócio Puras (Entidades, Interfaces)
│       │   ├── application/         # Casos de Uso (Use Cases)
│       │   ├── infrastructure/      # Detalhes de Implementação (BD, Extratores)
│       │   │   ├── collectors/      # Extratores de APIs externas (AWS, Azure, BACEN, PNCP)
│       │   │   ├── resilience/      # Circuit Breaker, Retries, Fallback Engine
│       │   │   ├── database/        # ORM / SQLAlchemy Repositories
│       │   │   └── mcp/             # FastMCP Server Handlers
│       │   └── presentation/        # Controladores e Endpoints REST (FastAPI)
│       └── main.py
└── docs/
```

---

## 💻 Especificação do Front-End (proposta original)

- **Framework:** React 18+ com TypeScript
- **Estilização:** Tailwind CSS v3+
- **Biblioteca de Componentes:** `shadcn/ui` (construída sobre Radix UI Primitives)
- **Gerenciamento de Estado Server-Side / Cache:** TanStack Query v5
- **Gerenciamento de Estado Client-Side:** Zustand
- **Formulários e Validação:** React Hook Form + Zod
- **Visualização de Dados:** Recharts / Tremor

### Indicador de Integridade de Serviço (mockup original)

```tsx
export type ServiceStatus = 'OPERATIONAL' | 'DEGRADED' | 'FALLBACK_STALE' | 'OFFLINE';
```

---

## 🛡️ Estratégia de Resiliência (proposta original)

4 Camadas de Proteção (Defense in Depth):

```text
[ Requisição do Usuário / API ]
               │
               v
+------------------------------+
|   1. Circuit Breaker         | ──(Se Aberto)──> [ Ir para Camada 3: Cache / Stale ]
+--------------+---------------+
               │ (Se Fechado/Half-Open)
               v
+------------------------------+
|   2. Exponential Backoff     | ──(Falhou 3x)──> [ Ir para Camada 3: Cache / Stale ]
+--------------+---------------+
               │ (Sucesso)
               v
+------------------------------+
|   3. Local Cache / Stale DB  | ──(Cache Vazio)─> [ Ir para Camada 4: Static Fallback ]
+--------------+---------------+
               │ (Encontrado)
               v
+------------------------------+
|   4. Static Safe Fallback    |
|  (Valores Históricos de RF)  |
+------------------------------+
```

### Matriz de Tratamento de Falhas por Fonte de Dados (proposta original)

| Fonte de Dados | Modo de Falha Principal | Fallback Nível 1 | Fallback Nível 2 | Indicador Visual |
| :--- | :--- | :--- | :--- | :--- |
| **BACEN (PTAX)** | Indisponibilidade na API Olinda / Fim de Semana | Último dia útil salvo no BD local | Cotação fixa de contingência | `FALLBACK_STALE` |
| **AWS Price API** | Throttling / Rate Limit / Timeout | Cache DuckDB/Redis (TTL 24h) | Tabela genérica de custos médios por região | `DEGRADED` |
| **Azure Retail** | Mudança no modelo do JSON / Timeout | Cache local histórico por SKU/Região | Estimativa por SKU similar | `FALLBACK_STALE` |
| **PNCP (Licitações)** | Instabilidade no portal do governo | Snapshot diário persistido localmente | Ocultar aba de inteligência competitiva | `OFFLINE` |
| **CAGED (MTE)** | Mudança de schema / FTP inacessível | Tabela histórica de CBOs pré-processada | Mediana regional do último quadrimestre | `FALLBACK_STALE` |

---

## 🗓️ Plano de Execução Original

1. **Fase 1 (Core & Backend Resiliente):** PostgreSQL + DuckDB, extratores com `ResilienceManager`, rotas FastAPI.
2. **Fase 2 (Frontend React + Tailwind + shadcn/ui):** componentes de UI, dashboards, alertas de status, calculadoras.
3. **Fase 3 (Integração MCP Server):** exposição das ferramentas do backend via Model Context Protocol.

**O que efetivamente saiu do papel, e como:** ver [`ARQUITETURA.md`](ARQUITETURA.md).
