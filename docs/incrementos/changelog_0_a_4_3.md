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

### Incremento 5 — Backup Frio

**Escopo**: Backup e restauracao do EventLog.

**Componentes**:
- `backup_frio_eventlog.ts` - Script de backup/restore
- Manifest com checksums SHA-256

**Comandos**:
- `npm run backup-frio`

---

### Incremento 6 — Observabilidade

**Escopo**: Control-plane para monitoramento interno.

**Componentes**:
- `control-plane/Server.ts` - Servidor HTTP
- Dashboard de protocolos

**Endpoints**:
- `GET /health/eventlog`
- `GET /audit/export`
- `GET /audit/replay`
- `GET /dashboard/protocols`
- `GET /dashboard/summary`

---

### Incremento 7 — Interface Controlada Bazari

**Escopo**: Adapter para integracao Bazari <-> Libervia.

**Componentes**:
- `BazariAdapter` - Interface controlada
- Load test script

**Garantias**:
- Unica saida = ContratoDeDecisao
- Sem vazamento de dados internos
- Protocolo obrigatorio

**Comandos**:
- `npm run bazari:load-test`

---

### Incremento 8 — Preparacao Go-Live

**Escopo**: Validacao de prontidao para producao.

**Componentes**:
- `drill_go_live.ts` - Script de drill
- 7 cenarios de caos

**Comandos**:
- `npm run drill:go-live`

**Garantias Validadas**:
- Sem delete/update
- Replay deterministico
- Adapter funcional
- Chain valida

---

### Incremento 9 — Operacao Continua

**Escopo**: Institucionalizar operacao continua com cadencia, metricas e alertas.

**Componentes**:
- `operacao_metrics.ts` - Script de coleta de metricas
- Endpoint `/metrics/operacao` no control-plane
- Template de operacao continua

**Comandos**:
- `npm run operacao:metrics`

**Metricas Monitoradas**:
- Estado do EventLog (eventos, segmentos, chain)
- Ultimo drill (tempo, status, taxa sucesso)
- Ultimo backup (data, tamanho, chain)
- Dias desde ultimo drill/backup

**Alertas**:
- WARNING: Thresholds de aviso
- CRITICAL: Thresholds criticos
- Exit codes: 0 (OK), 1 (WARNING), 2 (CRITICAL)

**Cadencia Definida**:
- Drill: Quinzenal
- Backup: Semanal
- Dashboard: Diario
- Metricas: Continuo

**Documentacao**:
- `docs/estado/operacao_continua.md` - Registro de operacoes
- `docs/runbooks/operacao_continua.md` - Procedimentos

---

### Incremento 10 — Seguranca Reforcada

**Escopo**: Backup multi-destino com assinatura digital e autenticacao reforcada.

**Componentes**:
- `scripts/crypto_utils.ts` - Utilitarios Ed25519
- `scripts/backup_frio_secure.ts` - Backup assinado multi-destino
- `control-plane/auth.ts` - Autenticacao reforcada

**Comandos**:
- `npm run backup:secure` - Backup com assinatura
- `npm run crypto:generate-keys` - Gerar par de chaves

**Features**:
- Assinatura digital Ed25519 de manifests
- Multiplos destinos de backup (local, S3, GCS, cold)
- Verificacao de assinatura na restauracao
- Rate limiting no control-plane
- Constant-time token comparison
- Metricas de seguranca (`/metrics/security`)

**Garantias**:
- Manifest alterado = assinatura invalida = restauracao bloqueada
- Token obrigatorio em producao
- Rate limit 100 req/min por IP
- Chaves privadas nunca no repo

**Testes**:
- 27 testes de seguranca em `incremento9.test.ts`

**Documentacao**:
- `docs/incrementos/incremento9_seguranca.md` - Design
- `docs/runbooks/gestao_chaves.md` - Gestao de chaves
- `docs/runbooks/desastre_backup_frio.md` - Atualizado

---

## Roadmap Pos Go-Live (Aprovado)

Apos conclusao dos Incrementos 0-10, o sistema esta pronto para producao. O roadmap futuro foi documentado em [roadmap_pos_golive.md](roadmap_pos_golive.md).

### Proximos Incrementos Planejados

| Incremento | Nome | Horizonte | Status |
|------------|------|-----------|--------|
| 11 | Hardening de Producao | Q1 2026 | Planejado |
| 12 | Observabilidade Proativa | Q1 2026 | Planejado |
| 13 | Auditoria Externa | Q2 2026 | Planejado |
| 14 | Multi-Tenancy Preparatorio | Q3 2026 | Planejado |
| 15 | Integracao Agentes Funcao | Q4 2026 | Planejado |
| 16 | Agentes de Observacao | 2027+ | Planejado |
| 17 | Federacao Institucional | 2027+ | Planejado |

### Garantias Canonicas Preservadas

Todos os incrementos futuros devem preservar:

1. **Imutabilidade** - Decisoes, contratos e episodios nao podem ser alterados
2. **Append-only** - EventLog so permite adicao
3. **Chain Integrity** - Hashes encadeados detectam corrupcao
4. **Single Output** - Unica saida para Bazari = ContratoDeDecisao
5. **No Ranking** - MemoryQueryService nao ordena por relevancia
6. **Protocol Required** - Toda decisao exige protocolo validado

### Governanca

Processo de governanca documentado em [governanca_incremental.md](../runbooks/governanca_incremental.md).

### Revisao Trimestral

Proxima revisao: **2026-03-23**

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
*Versao: 10.1 (com roadmap pos go-live)*
