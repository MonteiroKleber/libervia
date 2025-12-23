# Changelog: Incrementos 0–4.3

## Visao Geral

Este documento descreve a API publica do OrquestradorCognitivo e o historico dos incrementos implementados no projeto Libervia.

---

## API Publica do OrquestradorCognitivo

### Metodos Publicos

| Metodo | Incremento | Descricao |
|--------|------------|-----------|
| `constructor()` | 0 | Instancia o orquestrador com repositorios e servicos |
| `init()` | 4.1 | Inicializa e verifica integridade do EventLog |
| `GetEventLogStatus()` | 4.1 | Retorna status atual do EventLog (enabled, degraded, erros) |
| `VerifyEventLogNow()` | 4.1 | Forca verificacao da cadeia de hashes |
| `ProcessarSolicitacao(situacao)` | 0/1 | Processa solicitacao e cria episodio |
| `ConstruirProtocoloDeDecisao(episodio_id, dados)` | 3 | Constroi protocolo formal de decisao |
| `RegistrarDecisao(episodio_id, decisao)` | 0/3 | Registra decisao e emite contrato |
| `IniciarObservacao(episodio_id)` | 0 | Transiciona episodio para observacao |
| `EncerrarEpisodio(episodio_id)` | 0 | Encerra episodio |
| `ConsultarMemoriaDuranteAnalise(situacao_id, query)` | 1 | Consulta memoria durante analise |
| `ExportEventLogForAudit(options?)` | 4.3 | Exporta eventos para auditoria externa |
| `ReplayEventLog(options?)` | 4.3 | Gera resumo operacional do EventLog |

### Assinaturas Detalhadas

```typescript
// Incremento 0 - Core
constructor(
  situacaoRepo: SituacaoRepository,
  episodioRepo: EpisodioRepository,
  decisaoRepo: DecisaoRepository,
  contratoRepo: ContratoRepository,
  memoryService: MemoryQueryService,
  protocoloRepo?: DecisionProtocolRepository,  // Inc 3
  eventLog?: EventLogRepository                 // Inc 4
)

// Incremento 0/1 - Fluxo Principal
async ProcessarSolicitacao(situacao: SituacaoDecisoria): Promise<EpisodioDecisao>
async RegistrarDecisao(
  episodio_id: string,
  decisaoInput: Omit<DecisaoInstitucional, 'id' | 'episodio_id' | 'data_decisao'>
): Promise<ContratoDeDecisao>
async IniciarObservacao(episodio_id: string): Promise<void>
async EncerrarEpisodio(episodio_id: string): Promise<void>

// Incremento 1 - Memoria
async ConsultarMemoriaDuranteAnalise(
  situacao_id: string,
  query: MemoryQuery
): Promise<MemoryQueryResult>

// Incremento 3 - Protocolo
async ConstruirProtocoloDeDecisao(
  episodio_id: string,
  dados: DadosProtocoloInput
): Promise<DecisionProtocol>

// Incremento 4.1 - EventLog Safety
async init(): Promise<void>
GetEventLogStatus(): EventLogStatus
async VerifyEventLogNow(): Promise<ChainVerificationResult>

// Incremento 4.3 - Auditoria
async ExportEventLogForAudit(options?: ExportRangeOptions): Promise<ExportRangeResult>
async ReplayEventLog(options?: ReplayOptions): Promise<ReplayResult>
```

---

## Historico dos Incrementos

### Incremento 0 — Orquestrador Base

**Escopo**: Estrutura inicial do OrquestradorCognitivo.

**Principios**:
- NAO recomenda decisoes
- NAO otimiza resultados
- NAO executa acoes (isso e Bazari)
- UNICA saida para Bazari: ContratoDeDecisao

**API**:
- `ProcessarSolicitacao()`
- `RegistrarDecisao()`
- `IniciarObservacao()`
- `EncerrarEpisodio()`

---

### Incremento 1 — Persistencia e Consulta da Memoria Institucional

**Escopo**: Sistema de persistencia completo com repositorios e consulta a memoria.

**Componentes**:
- `JsonFileStore` - Persistencia atomica
- Repositorios: Situacao, Episodio, Decisao, Contrato
- `MemoryQueryService` - Consulta sem ranking

**API Adicionada**:
- `ConsultarMemoriaDuranteAnalise()`

**Garantias**:
- Episodio nao pode ser deletado
- Decisao nao pode ser alterada
- Contrato nao pode ser alterado
- Nucleo da situacao trava a partir de ACEITA
- Anexo e append-only
- Consulta de memoria so ocorre em EM_ANALISE
- MemoryQueryService NAO faz ranking

---

### Incremento 2 — Indices para Consultas Eficientes

**Escopo**: Otimizacao de consultas com indices em memoria.

**Indices Implementados**:
- Por `caso_uso`
- Por `estado`
- Por `dominio` (case-insensitive)

**Features**:
- Paginacao com cursor
- Batch lookup (`getByEpisodioIds`)
- Limite maximo respeitado (20 padrao, 100 max)

---

### Incremento 3 — Protocolo Formal de Decisao

**Escopo**: Formalizacao do raciocinio institucional minimo antes de criar DecisaoInstitucional.

**Componentes**:
- `DecisionProtocol` - Entidade
- `DecisionProtocolRepository` - Repositorio

**API Adicionada**:
- `ConstruirProtocoloDeDecisao()`

**Garantias**:
- Criar decisao sem protocolo gera erro
- Protocolo incompleto e REJEITADO
- Alternativa invalida e REJEITADA
- Memoria usada sem anexo e REJEITADA
- Protocolo rejeitado nao gera decisao
- Update/delete inexistentes
- Consistencia entre protocolo e decisao

---

### Incremento 4 — Event-Log com Hash Encadeado

**Escopo**: Log imutavel de eventos com cadeia de hashes SHA-256.

**Componentes**:
- `EventLogEntry` - Estrutura do evento
- `EventLogRepository` - Interface
- `EventLogRepositoryImpl` - Implementacao
- `HashUtil` - Utilitarios de hash

**Garantias**:
- Hash encadeado valido
- Alteracao retroativa quebra cadeia
- Ordem cronologica preservada
- Append-only garantido
- verifyChain detecta corrupcao

---

### Incremento 4.1 — EventLog Production Safety

**Escopo**: Seguranca operacional do EventLog em producao.

**API Adicionada**:
- `init()` - Inicializacao com verificacao
- `GetEventLogStatus()` - Status atual
- `VerifyEventLogNow()` - Verificacao sob demanda

**Garantias**:
- init() detecta corrupcao e marca degraded
- Ring buffer limita erros a 20
- Operacoes continuam se EventLog falhar
- "EventLog observa, nao governa"

---

### Incremento 4.2 — Rotacao, Snapshot e Retencao

**Escopo**: Gerenciamento de segmentos e checkpoint.

**Features**:
- Rotacao de segmentos (`segmentSize`)
- Snapshot como checkpoint (`snapshotEvery`)
- Politica de retencao (`prune()`)
- Migracao de formato legado

**Garantias**:
- verifyChain atravessa segmentos
- Snapshot permite verificacao rapida
- Persistencia atravessa restart

---

### Incremento 4.3 — Auditoria Operacional

**Escopo**: Capacidades de export, replay e verificacao incremental.

**API Adicionada**:
- `ExportEventLogForAudit()` - Export para auditoria
- `ReplayEventLog()` - Resumo operacional

**Features**:
- `exportRange()` - Export por intervalo
- `replay()` - Resumo deterministico
- `verifyFromSnapshot()` - Verificacao rapida

**Limites de Seguranca**:
- MAX_EVENTS_EXPORT = 10.000
- MAX_EVENTS_REPLAY = 50.000

---

## Compatibilidade

### Metodos Privados (Nao Usar Diretamente)

Os seguintes metodos sao privados e nao fazem parte da API publica:

- `CriarEpisodio()` - Interno
- `EmitirContrato()` - Interno
- `RegistrarMemoriaConsultada()` - Interno
- `logEvent()` - Interno
- `addError()` - Interno
- `gerarId()` - Interno

### Dependencias Opcionais

| Dependencia | Obrigatoria | Desde |
|-------------|-------------|-------|
| `protocoloRepo` | Sim (Inc 3+) | 3 |
| `eventLog` | Nao | 4 |

Se `eventLog` nao for fornecido, os metodos de EventLog retornam valores vazios/neutros sem erro.

---

## Verificacao de Assinaturas

Para verificar que a API publica esta alinhada com este changelog:

```bash
# Ver metodos publicos do Orquestrador
grep -E "async [A-Z][a-zA-Z]+\(" orquestrador/OrquestradorCognitivo.ts
grep "GetEventLogStatus" orquestrador/OrquestradorCognitivo.ts
```

---

*Documento gerado em: 2025-12-23*
*Versao: 4.3*
