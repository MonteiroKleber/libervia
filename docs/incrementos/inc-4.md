# INCREMENTO 4 — EVENT-LOG COM HASH ENCADEADO (IMUTABILIDADE)

## VISÃO GERAL

O Incremento 4 adiciona **imutabilidade verificável** à Memória Institucional da Libervia através de um **event-log com hash encadeado**.

### Princípios Fundamentais

- **ZERO dependência externa**: Não usa blockchain nem serviços externos
- **ZERO bloqueio**: O log observa, não governa — falhas de log não bloqueiam operações
- **100% compatível**: Incrementos 0–3 funcionam com ou sem EventLog
- **Preparado para o futuro**: Estrutura permite ancoragem futura em blockchain

---

## O QUE ESTE INCREMENTO FAZ

| Capacidade | Descrição |
|------------|-----------|
| Registro imutável | Cada evento relevante gera um registro no log |
| Hash encadeado | Cada registro contém o hash do evento anterior |
| Detecção de alteração | Qualquer modificação retroativa quebra a cadeia |
| Auditoria offline | Verificação de integridade sem dependências externas |

---

## MODELO DO EVENTO (CANÔNICO)

```typescript
interface EventLogEntry {
  id: string;                    // ID único do evento
  timestamp: Date;               // Timestamp do evento
  actor: 'Libervia' | 'Bazari';  // Ator que originou o evento
  evento: string;                // Tipo do evento
  entidade: string;              // Tipo da entidade afetada
  entidade_id: string;           // ID da entidade afetada
  payload_hash: string;          // SHA-256 do payload
  previous_hash: string | null;  // Hash do evento anterior (null no genesis)
  current_hash: string;          // Hash deste evento
}
```

---

## HASH ENCADEADO (REGRA DE OURO)

```
current_hash = SHA256(
  previous_hash +
  timestamp +
  actor +
  evento +
  entidade +
  entidade_id +
  payload_hash
)
```

**Regras invioláveis:**
- `previous_hash = null` **apenas** no evento genesis
- **Nunca recalcular** hashes existentes
- **Nunca atualizar** eventos
- **Nunca deletar** eventos

---

## EVENTOS REGISTRADOS

| Evento | Origem | Actor |
|--------|--------|-------|
| SITUACAO_CRIADA | ProcessarSolicitacao | Bazari |
| SITUACAO_STATUS_ALTERADO | Transições de status | Libervia |
| EPISODIO_CRIADO | CriarEpisodio | Libervia |
| EPISODIO_ESTADO_ALTERADO | updateEstado | Libervia |
| PROTOCOLO_VALIDADO | ConstruirProtocoloDeDecisao | Libervia |
| PROTOCOLO_REJEITADO | ConstruirProtocoloDeDecisao | Libervia |
| DECISAO_REGISTRADA | RegistrarDecisao | Libervia |
| CONTRATO_EMITIDO | EmitirContrato | Libervia |
| MEMORIA_CONSULTADA | ConsultarMemoriaDuranteAnalise | Libervia |

---

## ESTRUTURA DE ARQUIVOS

```
incremento-1/
├── event-log/
│   ├── EventLogEntry.ts           # Interface do evento + enums
│   ├── EventLogRepository.ts      # Interface do repositório
│   └── EventLogRepositoryImpl.ts  # Implementação com hash encadeado
├── utilitarios/
│   └── HashUtil.ts                # SHA-256 e funções de hash
├── orquestrador/
│   └── OrquestradorCognitivo.ts   # Integração com EventLog (opcional)
└── testes/
    └── incremento4.test.ts        # Testes do Incremento 4
```

---

## INTEGRAÇÃO COM ORQUESTRADOR

O EventLog é **opcional** — o Orquestrador funciona normalmente sem ele:

```typescript
// Orquestrador SEM EventLog (funciona normalmente)
const orquestrador = new OrquestradorCognitivo(
  situacaoRepo,
  episodioRepo,
  decisaoRepo,
  contratoRepo,
  memoryService,
  protocoloRepo
);

// Orquestrador COM EventLog (registra eventos automaticamente)
const orquestrador = new OrquestradorCognitivo(
  situacaoRepo,
  episodioRepo,
  decisaoRepo,
  contratoRepo,
  memoryService,
  protocoloRepo,
  eventLog  // OPCIONAL: adiciona logging imutável
);
```

---

## VERIFICAÇÃO DE INTEGRIDADE

```typescript
const eventLog = await EventLogRepositoryImpl.create('./data');

// Verificar cadeia completa
const result = await eventLog.verifyChain();

if (result.valid) {
  console.log(`Cadeia íntegra: ${result.totalVerified} eventos verificados`);
} else {
  console.error(`Corrupção detectada no índice ${result.firstInvalidIndex}`);
  console.error(`Motivo: ${result.reason}`);
}
```

---

## TESTES DO INCREMENTO 4

| # | Teste | Descrição |
|---|-------|-----------|
| 1 | Hash encadeado válido | Eventos consecutivos formam cadeia válida |
| 2 | Alteração retroativa quebra cadeia | Modificação é detectada por verifyChain |
| 3 | Ordem cronológica preservada | Eventos retornados em ordem temporal |
| 4 | Append-only garantido | Métodos update/delete não existem |
| 5 | verifyChain detecta corrupção | Vários cenários de corrupção testados |
| 6 | Compatível com Incrementos 1-3 | Orquestrador funciona com e sem EventLog |
| 7 | Persistência do EventLog | Eventos sobrevivem restart |
| 8 | Consultas ao EventLog | getByEvento, getByEntidade, getById, count |
| 9 | Hash do payload | Payloads diferentes geram hashes diferentes |
| 10 | Atores (Libervia e Bazari) | Actor é registrado corretamente |
| 11 | Garantias anteriores preservadas | Fluxo completo funciona com EventLog |

---

## O QUE O EVENTLOG NÃO FAZ

| Ação | Status |
|------|--------|
| Bloquear operações | ❌ NÃO |
| Validar regras de negócio | ❌ NÃO |
| Modificar eventos existentes | ❌ NÃO |
| Corrigir automaticamente | ❌ NÃO |
| Recomendar ou interpretar | ❌ NÃO |

O EventLog **APENAS observa e registra** — nunca governa.

---

## GARANTIAS PRESERVADAS

| Incremento | Garantia | Status |
|------------|----------|--------|
| 0 | SituaçãoDecisoria imutável a partir de ACEITA | ✅ |
| 0 | Máquina de estados rígida para Episódio | ✅ |
| 0 | DecisaoInstitucional imutável (1 por episódio) | ✅ |
| 0 | ContratoDeDecisao imutável (1 por episódio) | ✅ |
| 1 | Anexo append-only | ✅ |
| 1 | Consulta só em EM_ANALISE | ✅ |
| 1 | MemoryQueryService sem ranking | ✅ |
| 2 | Índices para consultas eficientes | ✅ |
| 3 | Protocolo obrigatório antes de decisão | ✅ |
| 3 | Protocolo imutável após criação | ✅ |
| 4 | Event-log com hash encadeado | ✅ NOVO |
| 4 | Verificação de integridade offline | ✅ NOVO |
| 4 | Rastreabilidade completa de eventos | ✅ NOVO |

---

## EVOLUÇÃO FUTURA (NÃO IMPLEMENTADA)

Este event-log foi projetado para permitir **ancoragem futura** em:

- **Blockchain pública**: Publicação periódica do hash da cadeia
- **Timestamping externo**: Serviços de carimbo de tempo certificado
- **Notarização distribuída**: Múltiplas testemunhas independentes
- **Merkle trees**: Compactação de provas de inclusão

**Sem mudança de modelo ou refatoração** — a estrutura atual é compatível.

---

## COMPLEXIDADE

| Operação | Complexidade |
|----------|--------------|
| append() | O(1) + I/O |
| getAll() | O(n) |
| getById() | O(n) |
| getByEvento() | O(n) |
| getByEntidade() | O(n) |
| verifyChain() | O(n) |
| count() | O(1) |

**Nota**: `n` = número total de eventos no log

---

## NOTAS DE IMPLEMENTAÇÃO

1. **EventLog é opcional**: Orquestrador funciona sem ele
2. **Falhas de log não bloqueiam**: Erros são silenciados (com console.error)
3. **Persistência em JSON**: Um arquivo `event-log.json` por diretório
4. **Reconstrução após restart**: Cadeia é validável após reload
5. **Hashes são hexadecimais**: SHA-256 produz 64 caracteres hex
6. **Ordem das chaves no payload**: Normalizada antes do hash

---

## INCREMENTO 4.1 — PRODUCTION SAFETY

O Incremento 4.1 adiciona **observabilidade e resiliência** ao EventLog para uso em produção.

### Novas Capacidades

| Capacidade | Descrição |
|------------|-----------|
| Health tracking | Estado de saúde do EventLog (enabled/degraded) |
| Auto-verificação | `init()` executa `verifyChain()` na inicialização |
| Ring buffer de erros | Últimos 20 erros mantidos para diagnóstico |
| Verificação sob demanda | `VerifyEventLogNow()` força verificação |
| Status público | `GetEventLogStatus()` retorna estado atual |

### Interface EventLogStatus

```typescript
interface EventLogStatus {
  enabled: boolean;        // true se EventLog configurado
  degraded: boolean;       // true se houve erro
  errorCount: number;      // Total de erros acumulados
  lastErrorAt?: Date;      // Timestamp do último erro
  lastErrorMsg?: string;   // Mensagem do último erro
  lastErrors: EventLogErrorEntry[];  // Ring buffer (max 20)
}

interface EventLogErrorEntry {
  ts: number;      // Timestamp (ms)
  evento: string;  // Tipo do evento que falhou
  msg: string;     // Mensagem de erro
}
```

### Uso Recomendado

```typescript
// Criar orquestrador COM EventLog
const orq = new OrquestradorCognitivo(
  situacaoRepo, episodioRepo, decisaoRepo, contratoRepo,
  memoryService, protocoloRepo, eventLog
);

// RECOMENDADO: Chamar init() para verificar cadeia
await orq.init();

// Verificar status
const status = orq.GetEventLogStatus();
if (status.degraded) {
  console.warn('EventLog degradado:', status.lastErrorMsg);
}

// Forçar verificação a qualquer momento
const result = await orq.VerifyEventLogNow();
if (!result.valid) {
  console.error('Corrupção detectada:', result.reason);
}
```

### Comportamento

1. **`init()` é opcional**: Orquestrador funciona sem chamar `init()`
2. **Falhas não bloqueiam**: Mesmo com `degraded=true`, operações continuam
3. **Ring buffer**: Apenas os últimos 20 erros são mantidos
4. **Erros acumulados**: `errorCount` nunca diminui

### Testes do Incremento 4.1

| # | Teste | Descrição |
|---|-------|-----------|
| 1 | GetEventLogStatus | Retorna estado correto (enabled/degraded) |
| 2 | init() detecta corrupção | Marca degraded=true se cadeia inválida |
| 3 | VerifyEventLogNow | Força verificação e atualiza status |
| 4 | Ring buffer de 20 | Após 25 erros, lastErrors tem 20 |
| 5 | Fluxo com init() | ProcessarSolicitacao funciona após init() |
| 6 | Resiliência | Operações continuam com EventLog falhando |

### Garantias Adicionais

| Garantia | Status |
|----------|--------|
| 4.1 | Health tracking do EventLog | ✅ NOVO |
| 4.1 | Verificação automática na inicialização | ✅ NOVO |
| 4.1 | Ring buffer para diagnóstico | ✅ NOVO |
| 4.1 | Operações nunca bloqueadas por EventLog | ✅ REFORÇADO |

---

## INCREMENTO 4.2 — ROTAÇÃO, SNAPSHOT E RETENÇÃO

O Incremento 4.2 adiciona **sustentabilidade em produção** ao EventLog, resolvendo o problema de crescimento infinito sem perder imutabilidade verificável.

### Novas Capacidades

| Capacidade | Descrição |
|------------|-----------|
| Segmentação | Log dividido em múltiplos arquivos (segmentos) |
| Rotação | Novo segmento criado ao atingir limite de eventos |
| Snapshot | Checkpoint para verificação rápida (fast verify) |
| Retenção | Política para remover segmentos antigos |
| Migração | Conversão automática do formato legado |

### Configuração (Defaults)

```typescript
interface EventLogConfig {
  segmentSize: number;       // 10_000 eventos por segmento
  snapshotEvery: number;     // Atualizar snapshot a cada 1000 eventos
  retentionSegments: number; // Manter últimos 30 segmentos
}

// Uso com configuração customizada
const eventLog = await EventLogRepositoryImpl.create('./data', {
  segmentSize: 5000,
  snapshotEvery: 500,
  retentionSegments: 60
});
```

### Estrutura de Arquivos

```
data/
├── event-log/
│   ├── segment-000001.json
│   ├── segment-000002.json
│   ├── segment-000003.json
│   └── ...
├── event-log-snapshot.json
└── event-log.legacy.json (backup do formato antigo)
```

### Interface Snapshot

```typescript
interface EventLogSnapshot {
  version: 1;
  last_segment: number;
  last_index_in_segment: number;
  last_event_id: string;
  last_current_hash: string;
  last_timestamp: string; // ISO
  total_events: number;
}
```

### Encadeamento Entre Segmentos

O hash encadeado continua válido atravessando segmentos:

```
Segmento 1:
  evento[0]: previous_hash = null (genesis)
  evento[1]: previous_hash = evento[0].current_hash
  ...
  evento[N]: previous_hash = evento[N-1].current_hash

Segmento 2:
  evento[0]: previous_hash = Segmento1.evento[N].current_hash  // NÃO é genesis!
  evento[1]: previous_hash = evento[0].current_hash
  ...
```

**Regra**: `previous_hash = null` **APENAS** no primeiro evento do primeiro segmento.

### Verificação

```typescript
// Fast verify (usa snapshot como checkpoint)
const result = await eventLog.verifyChain();

// Full verify (desde genesis, ignora snapshot)
const resultFull = await eventLog.verifyChainFull();
```

### Política de Retenção

```typescript
// Remover segmentos antigos manualmente
const pruneResult = await eventLog.prune();
// { segmentsRemoved: 2, eventsRemoved: 20000 }
```

**Garantias do prune():**
- Nunca remove segmentos dentro do limite de retenção
- Avança snapshot para ponto seguro antes de remover
- Mantém cadeia verificável após remoção
- Não roda automaticamente (operacional)

### Migração do Legado

Se existir `event-log.json` (formato antigo):

1. Na primeira inicialização, detecta arquivo legado
2. Cria diretório `event-log/`
3. Move conteúdo para `segment-000001.json`
4. Cria `event-log-snapshot.json`
5. Renomeia legado para `event-log.legacy.json`

A migração é **idempotente** e **segura**.

### Testes do Incremento 4.2

| # | Teste | Descrição |
|---|-------|-----------|
| 1 | Rotação de segmentos | Múltiplos segmentos criados ao ultrapassar limite |
| 2 | verifyChain atravessa segmentos | Cadeia válida entre segmentos, corrupção detectada |
| 3 | Snapshot funciona | Criado após rotação, usado em fast verify |
| 4 | Política de retenção | prune() mantém N segmentos, avança snapshot |
| 5 | Migração do legado | event-log.json → segment-000001.json |
| 6 | Persistência após restart | Eventos e snapshot sobrevivem restart |
| 7 | Compatibilidade API | getById, getByEvento, etc. funcionam |

### Garantias Adicionais

| Garantia | Status |
|----------|--------|
| 4.2 | Segmentação do log | ✅ NOVO |
| 4.2 | Rotação automática | ✅ NOVO |
| 4.2 | Snapshot para fast verify | ✅ NOVO |
| 4.2 | Retenção configurável | ✅ NOVO |
| 4.2 | Migração automática do legado | ✅ NOVO |
| 4.2 | Encadeamento válido entre segmentos | ✅ NOVO |
| 4.2 | verifyChainFull() desde genesis | ✅ NOVO |

### Notas de Implementação

1. **Append-only preservado**: Segmentos são imutáveis após rotação
2. **Snapshot é derivado**: Pode ser recriado a partir dos segmentos
3. **Cache em memória**: getAll() carrega todos os segmentos (atenção em produção)
4. **Escrita atômica**: tmp + rename para segmentos e snapshot
5. **prune() é operacional**: Não roda automaticamente no append

---

## INCREMENTO 4.3 — AUDITORIA OPERACIONAL

O Incremento 4.3 transforma o EventLog em um componente **auditável e operável em produção**, adicionando capacidades de export, replay e verificação incremental.

### Novas Capacidades

| Capacidade | Descrição |
|------------|-----------|
| exportRange() | Exportar eventos por intervalo para auditoria externa |
| replay() | Gerar resumo operacional determinístico |
| verifyFromSnapshot() | Verificação rápida a partir do checkpoint |
| Orquestrador | ExportEventLogForAudit() e ReplayEventLog() |

### Export de Eventos

```typescript
// Exportar todos os eventos
const result = await eventLog.exportRange();

// Exportar por intervalo de tempo
const result = await eventLog.exportRange({
  fromTs: new Date('2024-01-01'),
  toTs: new Date('2024-12-31')
});

// Exportar por segmentos específicos
const result = await eventLog.exportRange({
  fromSegment: 5,
  toSegment: 10
});
```

**Resultado do Export:**
```typescript
interface ExportRangeResult {
  entries: EventLogEntry[];  // Eventos exportados
  manifest: {
    fromTs: string | null;
    toTs: string | null;
    fromSegment: number | null;
    toSegment: number | null;
    count: number;
    firstId: string | null;
    lastId: string | null;
    chainValidWithinExport: boolean;  // Integridade verificada
  };
}
```

**Regras de chainValidWithinExport:**
- Se export começa no genesis: valida `previous_hash = null` + encadeamento + hashes
- Se export começa no meio: valida apenas encadeamento interno

**Limite de segurança:** Máximo de 10.000 eventos por export (configurável)

### Replay (Resumo Operacional)

```typescript
// Replay completo
const resumo = await eventLog.replay();

// Replay com filtros
const resumo = await eventLog.replay({
  evento: 'DECISAO_REGISTRADA',
  entidade: 'DecisaoInstitucional',
  fromTs: new Date('2024-01-01')
});
```

**Resultado do Replay:**
```typescript
interface ReplayResult {
  totalEventos: number;
  porEvento: Record<string, number>;   // { SITUACAO_CRIADA: 10, ... }
  porEntidade: Record<string, number>; // { SituacaoDecisoria: 10, ... }
  porAtor: Record<string, number>;     // { Libervia: 50, Bazari: 10 }
  range: { firstTs: string | null; lastTs: string | null };
  inconsistencias: Array<{ index: number; id: string; reason: string }>;
  truncated: boolean;  // true se excedeu limite
}
```

**Características:**
- Streaming por segmentos (não carrega tudo em memória)
- Detecta inconsistências durante processamento
- Filtros reduzem contagem, mas inconsistências são verificadas em todos os eventos
- Limite de segurança: 50.000 eventos (marca `truncated=true` se exceder)

### Verificação a partir do Snapshot

```typescript
// Verificação rápida (usa snapshot como checkpoint)
const result = await eventLog.verifyFromSnapshot();

// Se snapshot não existe, faz fallback para verificação completa
```

**Comportamento:**
1. Se snapshot existe e é válido: verifica apenas eventos após o snapshot
2. Se snapshot não existe: fallback para `verifyChain()` completo
3. Se snapshot está corrompido: fallback para verificação completa

### Integração com Orquestrador

```typescript
const orq = new OrquestradorCognitivo(
  situacaoRepo, episodioRepo, decisaoRepo, contratoRepo,
  memoryService, protocoloRepo, eventLog  // eventLog opcional
);

// Export para auditoria externa
const exportResult = await orq.ExportEventLogForAudit();

// Replay com filtros
const replayResult = await orq.ReplayEventLog({
  evento: 'CONTRATO_EMITIDO'
});
```

**Comportamento sem EventLog:**
- `ExportEventLogForAudit()`: retorna export vazio com `chainValidWithinExport=true`
- `ReplayEventLog()`: retorna resumo vazio com `truncated=false`

**Nunca bloqueia** — erros são capturados e status é atualizado.

### Testes do Incremento 4.3

| # | Teste | Descrição |
|---|-------|-----------|
| 1 | exportRange | Exporta todos, por tempo, valida chainValidWithinExport |
| 2 | replay | Resumo determinístico, filtros, inconsistências |
| 3 | verifyFromSnapshot | Fast verify, detecta corrupção, fallback |
| 4 | Orquestrador | ExportEventLogForAudit/ReplayEventLog sem eventLog |
| 5 | Limites | Export não lança erro abaixo do limite |

### Garantias Adicionais

| Garantia | Status |
|----------|--------|
| 4.3 | Export seguro para auditoria externa | ✅ NOVO |
| 4.3 | Replay determinístico (sem opinião) | ✅ NOVO |
| 4.3 | Verificação incremental via snapshot | ✅ NOVO |
| 4.3 | Limites de segurança configuráveis | ✅ NOVO |
| 4.3 | Streaming por segmentos (baixa memória) | ✅ NOVO |
| 4.3 | Preparado para ancoragem em blockchain | ✅ NOVO |

### Preparação para Blockchain (Não Implementado)

O Incremento 4.3 **prepara** o EventLog para ancoragem futura sem implementar blockchain:

1. **Export com manifest**: Formato padronizado para auditoria externa
2. **chainValidWithinExport**: Auditores podem verificar exports parciais
3. **Replay determinístico**: Mesma entrada sempre produz mesma saída
4. **Snapshot como checkpoint**: Base para Merkle proofs futuros

**Próximos passos (fora do escopo):**
- Publicar `last_current_hash` em blockchain a cada N eventos
- Gerar Merkle tree dos eventos para provas de inclusão
- Ancoragem periódica em serviços de timestamping

---

## PRÓXIMOS PASSOS (INCREMENTO 5+)

Sugestões para incrementos futuros:
- Ancoragem periódica em blockchain
- Merkle proofs para verificação parcial
- Compressão de segmentos antigos
- Busca otimizada com índices no EventLog
