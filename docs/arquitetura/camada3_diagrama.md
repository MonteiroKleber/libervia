# Arquitetura Macro - Camada 3 (Core Libervia)

**Data**: 2025-12-23
**Versão**: 1.0

---

## 1. Visão Geral

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CAMADA 4/5 - BAZARI (Executor)                          │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         BazariAdapter                                   │    │
│  │                                                                         │    │
│  │   • Traduz ações do mundo externo → Solicitações                        │    │
│  │   • Executa ContratoDeDecisao                                           │    │
│  │   • Integra com APIs, UI, sistemas externos                             │    │
│  └──────────────────────────────────┬──────────────────────────────────────┘    │
│                                     │                                           │
└─────────────────────────────────────┼───────────────────────────────────────────┘
                                      │ ProcessarSolicitacao()
                                      │ Retorna: ContratoDeDecisao
                                      ▼
╔═════════════════════════════════════════════════════════════════════════════════╗
║                         CAMADA 3 - LIBERVIA (Core)                              ║
║                                                                                 ║
║  ┌───────────────────────────────────────────────────────────────────────────┐  ║
║  │                                                                           │  ║
║  │                      ORQUESTRADOR COGNITIVO                               │  ║
║  │                                                                           │  ║
║  │   ┌─────────────────────────────────────────────────────────────────┐     │  ║
║  │   │                    ProcessarSolicitacao()                       │     │  ║
║  │   │                                                                 │     │  ║
║  │   │   1. Valida entrada                                             │     │  ║
║  │   │   2. Busca Situação                                             │     │  ║
║  │   │   3. Executa DecisionProtocol                                   │     │  ║
║  │   │   4. Registra no EventLog                                       │     │  ║
║  │   │   5. Emite ContratoDeDecisao                                    │     │  ║
║  │   └─────────────────────────────────────────────────────────────────┘     │  ║
║  │                                                                           │  ║
║  │   Garantias Canônicas:                                                    │  ║
║  │   ✓ Imutabilidade      ✓ Append-only       ✓ Chain Integrity              │  ║
║  │   ✓ Single Output      ✓ No Ranking        ✓ Protocol Required            │  ║
║  │                                                                           │  ║
║  └───────────────────────────────────────────────────────────────────────────┘  ║
║                                      │                                          ║
║          ┌───────────────────────────┼───────────────────────────┐              ║
║          │                           │                           │              ║
║          ▼                           ▼                           ▼              ║
║  ┌───────────────┐          ┌───────────────┐          ┌───────────────┐        ║
║  │               │          │               │          │               │        ║
║  │  Repositório  │          │  Repositório  │          │   EventLog    │        ║
║  │  Situações    │          │  Protocolos   │          │  Repository   │        ║
║  │               │          │               │          │               │        ║
║  │ • findById()  │          │ • findById()  │          │ • append()    │        ║
║  │ • save()      │          │ • findAll()   │          │ • getAll()    │        ║
║  │ • findAll()   │          │               │          │ • verifyChain │        ║
║  │               │          │               │          │ • replay()    │        ║
║  └───────┬───────┘          └───────┬───────┘          └───────┬───────┘        ║
║          │                          │                          │                ║
║          ▼                          ▼                          ▼                ║
║  ┌───────────────┐          ┌───────────────┐          ┌───────────────┐        ║
║  │   Situação    │          │   Protocolo   │          │ EventLogEntry │        ║
║  │   (Entity)    │          │   (Entity)    │          │   (Entity)    │        ║
║  │               │          │               │          │               │        ║
║  │ • id          │          │ • id          │          │ • hash        │        ║
║  │ • tipo        │          │ • nome        │          │ • prev_hash   │        ║
║  │ • contexto    │          │ • criterios   │          │ • actor       │        ║
║  │ • created_at  │          │ • acoes       │          │ • timestamp   │        ║
║  └───────────────┘          └───────────────┘          └───────────────┘        ║
║                                                                                 ║
╚═════════════════════════════════════════════════════════════════════════════════╝
                                      │
                                      │ Saída ÚNICA
                                      ▼
                         ┌─────────────────────────┐
                         │   ContratoDeDecisao     │
                         │                         │
                         │  • situacao_id          │
                         │  • protocolo_aplicado   │
                         │  • acao_determinada     │
                         │  • justificativa        │
                         │  • emitido_para: Bazari │
                         │  • timestamp            │
                         └─────────────────────────┘
```

---

## 2. Fluxo de Dados

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              FLUXO PRINCIPAL                                 │
└──────────────────────────────────────────────────────────────────────────────┘

   ENTRADA                      PROCESSAMENTO                        SAÍDA
   ───────                      ─────────────                        ─────

┌───────────┐              ┌─────────────────────┐              ┌──────────────┐
│Solicitação│─────────────▶│    Orquestrador     │─────────────▶│  Contrato    │
│           │              │                     │              │  de Decisão  │
│• tipo     │              │  1. Busca Situação  │              │              │
│• contexto │              │  2. Match Protocolo │              │• ação única  │
│• params   │              │  3. Aplica Critérios│              │• justificada │
└───────────┘              │  4. Log Imutável    │              │• auditável   │
                           └─────────────────────┘              └──────────────┘
                                     │
                                     │ Registro
                                     ▼
                           ┌─────────────────────┐
                           │      EventLog       │
                           │                     │
                           │ [E1]◀──[E2]◀──[E3]  │
                           │   │      │      │   │
                           │ hash   hash   hash  │
                           │   chain integrity   │
                           └─────────────────────┘
```

---

## 3. Componentes Principais

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DECISION PROTOCOL                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│   │    Critério 1   │     │    Critério 2   │     │    Critério N   │       │
│   │                 │     │                 │     │                 │       │
│   │  campo: X       │     │  campo: Y       │     │  campo: Z       │       │
│   │  operador: ==   │     │  operador: >    │     │  operador: in   │       │
│   │  valor: V       │     │  valor: 100     │     │  valor: [a,b,c] │       │
│   └────────┬────────┘     └────────┬────────┘     └────────┬────────┘       │
│            │                       │                       │                │
│            └───────────────────────┼───────────────────────┘                │
│                                    │                                        │
│                                    ▼                                        │
│                        ┌───────────────────────┐                            │
│                        │   TODOS devem passar  │                            │
│                        │   (AND lógico)        │                            │
│                        └───────────┬───────────┘                            │
│                                    │                                        │
│                    ┌───────────────┴───────────────┐                        │
│                    ▼                               ▼                        │
│           ┌───────────────┐               ┌───────────────┐                 │
│           │   MATCH ✓     │               │  NO MATCH ✗   │                 │
│           │               │               │               │                 │
│           │ Aplica ação   │               │ Próximo       │                 │
│           │ do protocolo  │               │ protocolo     │                 │
│           └───────────────┘               └───────────────┘                 │
│                                                                             │
│   REGRA: Primeiro protocolo que match = ÚNICA saída                         │
│   PROIBIDO: Ranking, scoring, múltiplas opções                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. EventLog - Cadeia Imutável

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             EVENT LOG CHAIN                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Segmento 1                  Segmento 2                  Segmento N        │
│   ──────────                  ──────────                  ──────────        │
│                                                                             │
│   ┌─────────┐                ┌─────────┐                ┌─────────┐         │
│   │ Entry 1 │───prev_hash───▶│ Entry N │───prev_hash───▶│Entry 2N │         │
│   │         │                │         │                │         │         │
│   │hash: A1 │                │hash: B1 │                │hash: C1 │         │
│   │prev: 00 │                │prev: A* │                │prev: B* │         │
│   └─────────┘                └─────────┘                └─────────┘         │
│       │                          │                          │               │
│       ▼                          ▼                          ▼               │
│   ┌─────────┐                ┌─────────┐                ┌─────────┐         │
│   │ Entry 2 │                │Entry N+1│                │Entry 2N+│         │
│   │         │                │         │                │         │         │
│   │hash: A2 │                │hash: B2 │                │hash: C2 │         │
│   │prev: A1 │                │prev: B1 │                │prev: C1 │         │
│   └─────────┘                └─────────┘                └─────────┘         │
│       │                          │                          │               │
│       ▼                          ▼                          ▼               │
│      ...                        ...                        ...              │
│                                                                             │
│   segment-000001.json        segment-000002.json        segment-NNNNNN.json │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│   VERIFICAÇÃO: hash[n] = SHA256(prev_hash + actor + evento + timestamp)    │
│   GARANTIA: Qualquer alteração quebra a cadeia                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Camadas e Responsabilidades

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SEPARAÇÃO DE CAMADAS                           │
└─────────────────────────────────────────────────────────────────────────────┘

     ┌─────────────────────────────────────────────────────────────────────┐
     │                                                                     │
  5  │   UI / Frontend                                                     │
     │   • Interface do usuário                                            │
     │   • Visualização de decisões                                        │
     │                                                                     │
     └─────────────────────────────────────────────────────────────────────┘
                                      │
     ┌─────────────────────────────────────────────────────────────────────┐
     │                                                                     │
  4  │   BazariAdapter                                                     │
     │   • Integração com sistemas externos                                │
     │   • Tradução de eventos → Solicitações                              │
     │   • Execução de ações determinadas                                  │
     │                                                                     │
     └─────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ ▲
                          Solicitação │ │ ContratoDeDecisao
                                      ▼ │
     ╔═════════════════════════════════════════════════════════════════════╗
     ║                                                                     ║
  3  ║   LIBERVIA CORE (Cérebro Institucional)                             ║
     ║                                                                     ║
     ║   ┌─────────────────────────────────────────────────────────────┐   ║
     ║   │ OrquestradorCognitivo                                       │   ║
     ║   │ • Processa solicitações                                     │   ║
     ║   │ • Aplica protocolos                                         │   ║
     ║   │ • Emite contratos                                           │   ║
     ║   └─────────────────────────────────────────────────────────────┘   ║
     ║                                                                     ║
     ║   ┌───────────────┐ ┌───────────────┐ ┌───────────────────────┐     ║
     ║   │ Repositórios  │ │   Entidades   │ │      EventLog         │     ║
     ║   │               │ │               │ │                       │     ║
     ║   │ • Situações   │ │ • Situação    │ │ • Registro imutável   │     ║
     ║   │ • Protocolos  │ │ • Protocolo   │ │ • Cadeia de hashes    │     ║
     ║   │               │ │ • Contrato    │ │ • Auditoria completa  │     ║
     ║   └───────────────┘ └───────────────┘ └───────────────────────┘     ║
     ║                                                                     ║
     ╚═════════════════════════════════════════════════════════════════════╝
                                      │
     ┌─────────────────────────────────────────────────────────────────────┐
     │                                                                     │
  2  │   Infraestrutura                                                    │
     │   • File System (segments, snapshots)                               │
     │   • Control Plane (métricas, backup)                                │
     │                                                                     │
     └─────────────────────────────────────────────────────────────────────┘
                                      │
     ┌─────────────────────────────────────────────────────────────────────┐
     │                                                                     │
  1  │   Sistema Operacional / Runtime                                     │
     │   • Node.js                                                         │
     │   • File I/O                                                        │
     │                                                                     │
     └─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Garantias Canônicas

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GARANTIAS CANÔNICAS                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  IMUTABILIDADE                                                      │   │
│   │  ═══════════════                                                    │   │
│   │  • Eventos nunca são alterados após registro                        │   │
│   │  • Hash chain garante integridade                                   │   │
│   │  • Qualquer modificação é detectável                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  APPEND-ONLY                                                        │   │
│   │  ═══════════                                                        │   │
│   │  • Apenas operação: adicionar ao final                              │   │
│   │  • Não existe delete, update, insert-at                             │   │
│   │  • Segmentos crescem monotonicamente                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  CHAIN INTEGRITY                                                    │   │
│   │  ═══════════════                                                    │   │
│   │  • hash[n] depende de hash[n-1]                                     │   │
│   │  • Verificação end-to-end em O(n)                                   │   │
│   │  • Detecção de gaps ou alterações                                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  SINGLE OUTPUT                                                      │   │
│   │  ═════════════                                                      │   │
│   │  • Uma solicitação → Um contrato                                    │   │
│   │  • Primeira regra que match = decisão final                         │   │
│   │  • Sem ambiguidade, sem múltiplas opções                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  NO RANKING                                                         │   │
│   │  ══════════                                                         │   │
│   │  • Sem scores, sem probabilidades                                   │   │
│   │  • Decisão é binária: match ou não match                            │   │
│   │  • Ordem dos protocolos é determinística                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  PROTOCOL REQUIRED                                                  │   │
│   │  ═════════════════                                                  │   │
│   │  • Toda decisão exige protocolo pré-definido                        │   │
│   │  • Sem decisões ad-hoc ou baseadas em heurística                    │   │
│   │  • Protocolo é auditável e versionado                               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Estrutura de Diretórios

```
incremento-1/
├── orquestrador/
│   └── OrquestradorCognitivo.ts     # Ponto de entrada principal
│
├── entidades/
│   ├── Situacao.ts                  # Contexto a ser avaliado
│   ├── Protocolo.ts                 # Regras de decisão
│   └── ContratoDeDecisao.ts         # Saída imutável
│
├── repositorios/
│   ├── SituacaoRepository.ts        # Interface
│   ├── SituacaoRepositoryImpl.ts    # Implementação
│   ├── ProtocoloRepository.ts       # Interface
│   └── ProtocoloRepositoryImpl.ts   # Implementação
│
├── servicos/
│   └── DecisionProtocol.ts          # Lógica de matching
│
├── event-log/
│   ├── EventLogEntry.ts             # Estrutura do evento
│   ├── EventLogRepository.ts        # Interface
│   └── EventLogRepositoryImpl.ts    # Implementação com hashing
│
├── control-plane/
│   ├── Server.ts                    # API de operações
│   └── auth.ts                      # Autenticação
│
└── scripts/
    ├── backup_frio_eventlog.ts      # Backup básico
    ├── backup_frio_secure.ts        # Backup assinado
    └── crypto_utils.ts              # Ed25519 utilities
```

---

*Documento gerado em: 2025-12-23*
