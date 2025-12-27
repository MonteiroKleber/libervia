# Incremento 15 — Consequências (observada vs percebida) + Observabilidade Real

## Resumo

Este incremento implementa o registro e consulta de consequências de decisões já executadas, mantendo uma trilha imutável e auditável. A arquitetura separa claramente:

- **Consequência observada**: fatos objetivos e mensuráveis
- **Consequência percebida**: avaliação do impacto sistêmico

## Princípios

1. **Pós-execução**: Consequências só podem ser registradas para contratos existentes
2. **Append-only**: Nunca editar, nunca deletar — apenas adicionar
3. **Imutável**: Cada registro é permanente
4. **Anti-fraude**: Exige `observacao_minima_requerida` do contrato
5. **Tenant-safe**: Isolamento por `dataDir`

## Arquitetura

```
ContratoDeDecisao (existente)
         │
         ▼
ObservacaoDeConsequencia (append-only)
         │
         ├── observada (fatos)
         │       ├── descricao
         │       ├── indicadores[]
         │       ├── anexos[]
         │       ├── limites_respeitados
         │       └── condicoes_cumpridas
         │
         └── percebida (avaliação)
                 ├── descricao
                 ├── sinal (POSITIVO|NEUTRO|NEGATIVO|INDETERMINADO)
                 ├── risco_percebido
                 ├── licoes
                 └── contexto_adicional
```

## Tipos

### SinalImpacto

```typescript
enum SinalImpacto {
  POSITIVO = 'POSITIVO',
  NEUTRO = 'NEUTRO',
  NEGATIVO = 'NEGATIVO',
  INDETERMINADO = 'INDETERMINADO'
}
```

### ObservacaoDeConsequencia

```typescript
interface ObservacaoDeConsequencia {
  id: string;
  contrato_id: string;
  episodio_id: string;
  observada: ConsequenciaObservada;
  percebida: ConsequenciaPercebida;
  evidencias_minimas: string[];
  registrado_por: string;
  data_registro: Date;
  observacao_anterior_id?: string;  // Para follow-ups
  notas?: string;
}
```

### RegistroConsequenciaInput

```typescript
interface RegistroConsequenciaInput {
  observada: ConsequenciaObservada;
  percebida: ConsequenciaPercebida;
  evidencias_minimas: string[];
  observacao_anterior_id?: string;
  notas?: string;
}
```

## API do OrquestradorCognitivo

### RegistrarConsequencia

```typescript
async RegistrarConsequencia(
  contratoId: string,
  input: RegistroConsequenciaInput,
  options?: { actor?: ActorId }
): Promise<ObservacaoDeConsequencia>
```

**Validações:**
1. `ObservacaoRepository` deve estar configurado
2. Contrato DEVE existir
3. Episódio deve estar em estado `DECIDIDO`, `EM_OBSERVACAO` ou `ENCERRADO`
4. Campos obrigatórios preenchidos
5. `evidencias_minimas` deve conter todas as evidências de `observacao_minima_requerida` do contrato
6. Se follow-up, observação anterior deve existir e pertencer ao mesmo contrato

### GetConsequenciasByContrato

```typescript
async GetConsequenciasByContrato(contratoId: string): Promise<ObservacaoDeConsequencia[]>
```

Retorna lista ordenada por `data_registro` (mais antiga primeiro).

### GetConsequenciasByEpisodio

```typescript
async GetConsequenciasByEpisodio(episodioId: string): Promise<ObservacaoDeConsequencia[]>
```

### CountConsequenciasByContrato

```typescript
async CountConsequenciasByContrato(contratoId: string): Promise<number>
```

## Repositório

### ObservacaoRepository (Interface)

```typescript
interface ObservacaoRepository {
  init(): Promise<void>;
  create(observacao: ObservacaoDeConsequencia): Promise<void>;
  getById(id: string): Promise<ObservacaoDeConsequencia | null>;
  getByContratoId(contrato_id: string): Promise<ObservacaoDeConsequencia[]>;
  getByEpisodioId(episodio_id: string): Promise<ObservacaoDeConsequencia[]>;
  getByDateRange(start: Date, end: Date): Promise<ObservacaoDeConsequencia[]>;
  countByContratoId(contrato_id: string): Promise<number>;
  // UPDATE é PROIBIDO
  // DELETE é PROIBIDO
}
```

### ObservacaoRepositoryImpl

- Persiste em `observacoes.json`
- Escrita atômica via `JsonFileStore`
- Índices em memória por `contrato_id` e `episodio_id`
- Retorna clones imutáveis

## Serviço de Consulta

### ConsequenciaQueryService

```typescript
class ConsequenciaQueryService {
  constructor(
    observacaoRepo: ObservacaoRepository,
    contratoRepo: ContratoRepository
  );

  getByContrato(contrato_id: string): Promise<ObservacaoDeConsequencia[]>;
  getByEpisodio(episodio_id: string): Promise<ObservacaoDeConsequencia[]>;
  getByDateRange(start: Date, end: Date): Promise<ObservacaoDeConsequencia[]>;
  find(query: ConsequenciaQuery): Promise<ConsequenciaQueryResult>;
  getStats(contrato_id: string): Promise<ConsequenciaStats>;
  countByContrato(contrato_id: string): Promise<number>;
  contratoExists(contrato_id: string): Promise<boolean>;
  getObservacaoMinimaRequerida(contrato_id: string): Promise<string[] | null>;
}
```

### ConsequenciaQuery

```typescript
interface ConsequenciaQuery {
  contrato_id?: string;
  episodio_id?: string;
  sinal?: SinalImpacto;
  data_inicio?: Date;
  data_fim?: Date;
  limit?: number;
}
```

### ConsequenciaStats

```typescript
interface ConsequenciaStats {
  total: number;
  por_sinal: Record<SinalImpacto, number>;
  primeira?: Date;
  ultima?: Date;
  limites_sempre_respeitados: boolean;
  condicoes_sempre_cumpridas: boolean;
}
```

## EventLog

Novo evento adicionado:

```typescript
enum TipoEvento {
  // ... existentes ...
  CONSEQUENCIA_REGISTRADA = 'CONSEQUENCIA_REGISTRADA'  // O que aconteceu
}

enum TipoEntidade {
  // ... existentes ...
  OBSERVACAO = 'ObservacaoDeConsequencia'  // Qual entidade foi afetada
}
```

**Nota:** `TipoEvento` e `TipoEntidade` são conceitos distintos:
- `TipoEvento.CONSEQUENCIA_REGISTRADA` = tipo do evento (ação)
- `TipoEntidade.OBSERVACAO` = tipo da entidade afetada (objeto)

Isso segue o padrão existente (ex: `CONTRATO_EMITIDO` usa `TipoEntidade.CONTRATO`).
NÃO são dois eventos separados.

## Exemplo de Uso

```typescript
// Configurar orquestrador com ObservacaoRepository
const observacaoRepo = await ObservacaoRepositoryImpl.create(dataDir);
const orquestrador = new OrquestradorCognitivo(
  situacaoRepo,
  episodioRepo,
  decisaoRepo,
  contratoRepo,
  memoryService,
  protocoloRepo,
  eventLog,
  observacaoRepo  // Novo parâmetro
);

// Após executar decisão e ter um contrato...

// Registrar consequência
const observacao = await orquestrador.RegistrarConsequencia(
  contrato.id,
  {
    observada: {
      descricao: 'Sistema processou 1000 transações em 5 minutos',
      indicadores: [
        { nome: 'tempo_total', valor: '5', unidade: 'minutos' },
        { nome: 'transacoes', valor: '1000' }
      ],
      limites_respeitados: true,
      condicoes_cumpridas: true
    },
    percebida: {
      descricao: 'Impacto positivo na operação',
      sinal: SinalImpacto.POSITIVO,
      licoes: 'Configuração otimizada funcionou bem'
    },
    evidencias_minimas: [
      'Impacto Técnico observado',
      'Impacto Operacional observado',
      'Evidências coletadas',
      'Persistência avaliada'
    ]
  },
  { actor: 'sistema-monitoramento' }
);

// Registrar follow-up
const followUp = await orquestrador.RegistrarConsequencia(
  contrato.id,
  {
    observada: {
      descricao: 'Após 24h, sistema mantém performance',
      limites_respeitados: true,
      condicoes_cumpridas: true
    },
    percebida: {
      descricao: 'Estabilidade confirmada',
      sinal: SinalImpacto.POSITIVO
    },
    evidencias_minimas: [
      'Impacto Técnico observado',
      'Impacto Operacional observado',
      'Evidências coletadas',
      'Persistência avaliada'
    ],
    observacao_anterior_id: observacao.id,
    notas: 'Acompanhamento de 24h'
  }
);

// Consultar consequências
const todas = await orquestrador.GetConsequenciasByContrato(contrato.id);
const count = await orquestrador.CountConsequenciasByContrato(contrato.id);
```

## Arquivos Criados/Modificados

### Criados
- `camada-3/entidades/ObservacaoDeConsequencia.ts`
- `camada-3/repositorios/interfaces/ObservacaoRepository.ts`
- `camada-3/repositorios/implementacao/ObservacaoRepositoryImpl.ts`
- `camada-3/servicos/ConsequenciaQueryService.ts`
- `testes/incremento15_consequencias.test.ts`
- `docs/incremento15_consequencias.md`

### Modificados
- `camada-3/event-log/EventLogEntry.ts` — Adicionado `CONSEQUENCIA_REGISTRADA` e `OBSERVACAO`
- `camada-3/orquestrador/OrquestradorCognitivo.ts` — Adicionado `RegistrarConsequencia`, `GetConsequenciasByContrato`, `GetConsequenciasByEpisodio`, `CountConsequenciasByContrato`

## Invariantes Garantidas

1. **Sem UPDATE**: `ObservacaoRepository` não tem método `update`
2. **Sem DELETE**: `ObservacaoRepository` não tem método `delete`
3. **Contrato obrigatório**: Consequências só existem para contratos existentes
4. **Anti-fraude**: Evidências mínimas são validadas contra o contrato
5. **Auditoria**: Todos os registros incluem `registrado_por` e `data_registro`
6. **Follow-ups rastreáveis**: `observacao_anterior_id` permite trilha de acompanhamento
7. **EventLog**: Cada registro gera evento `CONSEQUENCIA_REGISTRADA`

## Retrocompatibilidade

### Contratos Antigos

Contratos criados antes do Incremento 15 podem ter `observacao_minima_requerida` como `undefined` ou `[]`. O sistema trata esses casos de forma segura:

```typescript
// Tratamento no OrquestradorCognitivo:
const observacaoMinimaRequerida = contrato.observacao_minima_requerida ?? [];
```

**Comportamento:**
- `undefined` → tratado como `[]` (sem exigência adicional)
- `[]` → sem exigência adicional
- `['item1', 'item2']` → exige que `evidencias_minimas` contenha esses itens

**Regra:** O input SEMPRE deve ter pelo menos 1 item em `evidencias_minimas` (validação estrutural), mas se o contrato não define exigências específicas, qualquer evidência é aceita.

## O que NÃO faz

- NÃO reinterpreta consequências anteriores
- NÃO calcula scores ou rankings
- NÃO sugere melhorias
- NÃO prevê resultados
- NÃO modifica ou remove registros existentes
