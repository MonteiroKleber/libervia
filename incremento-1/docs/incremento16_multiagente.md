# Incremento 16 — Multiagente (Camada de Decisão)

## Resumo

Este incremento implementa suporte a **múltiplos agentes decisores** que processam a mesma situação sob perfis/mandatos distintos, produzindo propostas candidatas e uma agregação institucional final.

**IMPORTANTE**: Multiagente aqui NÃO é:
- LLM ou IA generativa
- Otimizador ou calculador estatístico
- Sistema de previsão

Multiagente é **divergência deliberada de perfis e critérios**, com rastreabilidade e auditoria completas.

## Princípios

1. **Core agnóstico**: Nenhuma referência a integrações específicas
2. **Closed Layer soberana**: Valida antes de cada agente propor decisão
3. **Um episódio por situação**: Não fragmentar vivência institucional
4. **Append-only**: EventLog continua imutável
5. **Determinístico**: Todas as políticas são regras fixas (sem ML)

## Arquitetura

```
SituacaoDecisoria
        │
        ▼
┌───────────────────────────────────────────────────────┐
│            ProcessarSolicitacaoMultiAgente            │
└───────────────────────────────────────────────────────┘
        │
        ├─── Criar/Obter Situação
        ├─── Criar Episódio único
        │
        ▼
┌───────────────────────────────────────────────────────┐
│                   MultiAgentRunner                    │
│                                                       │
│  Para cada AgentProfile habilitado:                   │
│  ┌─────────────────────────────────────────────────┐  │
│  │ 1. Construir protocolo com perfil do agente    │  │
│  │ 2. Validar Closed Layer                        │  │
│  │ 3. Se não bloqueado: criar decisão candidata   │  │
│  │ 4. Registrar eventos no EventLog              │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  Após todos os agentes:                               │
│  ┌─────────────────────────────────────────────────┐  │
│  │ Aplicar AggregationPolicy                      │  │
│  │ Se decidido: emitir ContratoDeDecisao final    │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
        │
        ▼
MultiAgentRunResult
  ├── runId
  ├── episodioId
  ├── agentResults[]
  ├── aggregation
  └── contratoFinal (ou null)
```

## Tipos Principais

### AgentProfile

```typescript
interface AgentProfile {
  agentId: string;           // ex: "conservador-1", "moderado-1"
  perfilRisco: PerfilRisco;  // CONSERVADOR | MODERADO | AGRESSIVO
  mandato?: string[];        // Frases/limites humanos adicionais
  peso?: number;             // Para agregação ponderada (default: 1)
  enabled?: boolean;         // Se habilitado (default: true)
}
```

### AggregationPolicy

```typescript
type AggregationPolicy =
  | 'FIRST_VALID'              // Primeira decisão válida
  | 'MAJORITY_BY_ALTERNATIVE'  // Alternativa mais votada
  | 'WEIGHTED_MAJORITY'        // Votação ponderada por peso
  | 'REQUIRE_CONSENSUS'        // Só decide se unanimidade
  | 'HUMAN_OVERRIDE_REQUIRED'; // Sempre retorna candidatos
```

### MultiAgentRunInput

```typescript
interface MultiAgentRunInput {
  agents: AgentProfile[];
  aggregationPolicy: AggregationPolicy;
  protocoloBase: {
    criterios_minimos: string[];
    riscos_considerados: string[];
    limites_definidos: Limite[];
    alternativas_avaliadas: string[];
  };
  decisaoBase: {
    criterios: string[];
    limites: Limite[];
    condicoes: string[];
  };
}
```

### MultiAgentRunResult

```typescript
interface MultiAgentRunResult {
  runId: string;
  episodioId: string;
  aggregationPolicy: AggregationPolicy;
  agentResults: AgentProposalResult[];
  aggregation: AggregationDecision;
  contratoFinal: ContratoDeDecisao | null;
  startedAt: Date;
  finishedAt: Date;
}
```

## Políticas de Agregação

### FIRST_VALID

Retorna a primeira decisão válida seguindo a ordem dos agentes.

- **Uso**: Quando há prioridade explícita entre agentes
- **Comportamento**: Ignora agentes bloqueados, usa o primeiro não-bloqueado

### MAJORITY_BY_ALTERNATIVE

A alternativa mais votada vence (cada agente = 1 voto).

- **Uso**: Decisão democrática entre perfis
- **Tie-break**: Lexicográfico (ver seção abaixo)

### WEIGHTED_MAJORITY

Idem MAJORITY, mas cada agente vota com seu `peso`.

- **Uso**: Quando alguns perfis têm mais autoridade
- **Exemplo**: Moderado com peso 5 vale mais que Conservador com peso 1

### REQUIRE_CONSENSUS

Só decide se TODOS os agentes válidos escolhem a mesma alternativa.

- **Uso**: Decisões críticas que exigem unanimidade
- **Retorno**: `NO_CONSENSUS` se houver divergência

### HUMAN_OVERRIDE_REQUIRED

Sempre retorna candidatos sem emitir contrato final.

- **Uso**: Modo supervisão humana
- **Retorno**: `HUMAN_OVERRIDE_PENDING` sempre

## Tie-break Determinístico

Quando há empate em políticas de votação:

1. **Alternativa lexicograficamente menor** vence
   - "Alfa" vence "Zebra"
   - String compare nativo

2. **Se alternativas idênticas**: usa ordem dos agentes na lista
   - Primeiro agente na lista vence

**Exemplo**:
```
Votos: { "Zebra": 2, "Alfa": 2 }
Resultado: "Alfa" (menor lexicograficamente)
```

## Seleção de Alternativa por Perfil

Cada agente escolhe alternativa baseado em seu perfil:

| Perfil | Seleção |
|--------|---------|
| CONSERVADOR | Primeira alternativa (índice 0) |
| MODERADO | Alternativa do meio |
| AGRESSIVO | Última alternativa |

Esta lógica é determinística e pode ser customizada.

## EventLog

Novos eventos adicionados:

```typescript
enum TipoEvento {
  // ... existentes ...

  // Multiagente (Incremento 16)
  MULTIAGENT_RUN_STARTED = 'MULTIAGENT_RUN_STARTED',
  AGENT_PROTOCOL_PROPOSED = 'AGENT_PROTOCOL_PROPOSED',
  AGENT_DECISION_PROPOSED = 'AGENT_DECISION_PROPOSED',
  MULTIAGENT_AGGREGATION_SELECTED = 'MULTIAGENT_AGGREGATION_SELECTED',
  MULTIAGENT_NO_DECISION = 'MULTIAGENT_NO_DECISION'
}

enum TipoEntidade {
  // ... existentes ...
  MULTIAGENT_RUN = 'MultiAgentRun'
}
```

**Payloads incluem**:
- `agentId` quando aplicável
- `episodio_id`
- `alternativaEscolhida`
- `blocked` e `blockRule` para bloqueios
- `votesByAlternative` para agregações

## API do OrquestradorCognitivo

### ProcessarSolicitacaoMultiAgente

```typescript
async ProcessarSolicitacaoMultiAgente(
  situacao: SituacaoDecisoria,
  input: MultiAgentRunInput,
  options?: { actor?: ActorId; emitidoPara?: string }
): Promise<MultiAgentRunResult>
```

**Exemplo de uso**:

```typescript
const situacao: SituacaoDecisoria = {
  id: 'sit-001',
  dominio: 'financeiro',
  // ... demais campos
};

const input: MultiAgentRunInput = {
  agents: [
    { agentId: 'conservador', perfilRisco: PerfilRisco.CONSERVADOR },
    { agentId: 'moderado', perfilRisco: PerfilRisco.MODERADO, peso: 2 },
    { agentId: 'agressivo', perfilRisco: PerfilRisco.AGRESSIVO }
  ],
  aggregationPolicy: 'WEIGHTED_MAJORITY',
  protocoloBase: {
    criterios_minimos: ['ROI positivo', 'Risco controlado'],
    riscos_considerados: ['Volatilidade de mercado'],
    limites_definidos: [{ tipo: 'Financeiro', descricao: 'Max 100k', valor: '100000' }],
    alternativas_avaliadas: ['Investir parcialmente', 'Investir totalmente', 'Não investir']
  },
  decisaoBase: {
    criterios: ['ROI positivo'],
    limites: [{ tipo: 'Financeiro', descricao: 'Max 100k', valor: '100000' }],
    condicoes: ['Aprovação do board']
  }
};

const result = await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);

if (result.aggregation.decided) {
  console.log('Contrato emitido:', result.contratoFinal?.id);
  console.log('Alternativa escolhida:', result.aggregation.alternativaFinal);
} else {
  console.log('Motivo:', result.aggregation.noDecisionReason);
}
```

## Arquivos Criados/Modificados

### Criados

| Arquivo | Descrição |
|---------|-----------|
| `camada-3/multiagente/MultiAgentTypes.ts` | Tipos principais |
| `camada-3/multiagente/MultiAgentAggregator.ts` | Funções de agregação |
| `camada-3/multiagente/MultiAgentRunner.ts` | Runner principal |
| `camada-3/multiagente/index.ts` | Barrel export |
| `testes/incremento16_multiagente.test.ts` | Testes |
| `docs/incremento16_multiagente.md` | Esta documentação |

### Modificados

| Arquivo | Mudança |
|---------|---------|
| `camada-3/event-log/EventLogEntry.ts` | Novos TipoEvento e TipoEntidade |
| `camada-3/orquestrador/OrquestradorCognitivo.ts` | Novo método ProcessarSolicitacaoMultiAgente |
| `camada-3/index.ts` | Exports do módulo multiagente |

## Compatibilidade

### Com Incrementos Anteriores

- **Inc 13 (Closed Layer)**: Continua soberana, valida cada agente
- **Inc 14 (Pesquisa)**: Não afetado, read-only permanece
- **Inc 15 (Consequências)**: Não afetado, append-only permanece
- **Inc 11/12 (Multi-tenant)**: Compatível, isolamento por tenant

### Com Fluxo Single-Agent

O fluxo tradicional continua funcionando normalmente:

```typescript
// Single-agent (ainda funciona)
const episodio = await orquestrador.ProcessarSolicitacao(situacao);
await orquestrador.ConstruirProtocoloDeDecisao(episodio.id, dados);
const contrato = await orquestrador.RegistrarDecisao(episodio.id, decisao);

// Multi-agent (nova API)
const result = await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);
```

## Invariantes Garantidas

1. **Um episódio por situação**: Multiagente cria apenas UM episódio
2. **Closed Layer obrigatória**: Todo agente passa por validação
3. **Eventos auditáveis**: Todas as propostas e agregações são logadas
4. **Determinístico**: Mesma entrada = mesma saída
5. **Compatibilidade**: Fluxo single-agent não é afetado

## Limitações

- Não suporta votação assíncrona (todos decidem na mesma chamada)
- Alternativas são fixas para todos os agentes
- Mandato adicional não influencia seleção automática (apenas para documentação)

## O que NÃO faz

- NÃO usa LLM ou IA generativa
- NÃO otimiza resultados
- NÃO prevê comportamentos
- NÃO modifica dados de forma não-rastreável
- NÃO quebra fluxos existentes
