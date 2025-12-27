# INCREMENTO 14 — CAMADA DE PESQUISA (Sandbox Runtime)

## Resumo

A Camada de Pesquisa é um ambiente de exploração isolado que permite analisar situações decisórias e variações **sem gerar consequência direta**. Funciona como um sandbox que garante:

- **Zero impacto em produção**: Não escreve em repositórios, EventLog, ou contratos
- **Exploração segura**: Permite testar hipóteses e variações sem risco
- **Diagnóstico da Camada Fechada**: Identifica bloqueios antes da execução real

## O que a Pesquisa FAZ

- Submeter situações para análise exploratória
- Rodar múltiplas variações (alternativas, riscos, perfis diferentes)
- Consultar memória institucional em modo **somente-leitura**
- Gerar relatórios com diagnósticos (não persistentes no Core)
- Identificar bloqueios da Camada Fechada antes de decidir

## O que a Pesquisa NÃO FAZ

- **Não registra episódios reais**
- **Não grava decisões institucionais**
- **Não emite contratos**
- **Não escreve no EventLog**
- **Não altera snapshots**
- **Não modifica repositórios do Core**
- **Não faz ranking/score numérico** (proibido por design)

## Arquitetura

```
camada-3/
└── pesquisa/
    ├── ResearchTypes.ts          # Tipos (Input, Report, Variation, etc.)
    ├── ReadOnlyRepositories.ts   # Wrappers anti-escrita
    ├── ResearchSandbox.ts        # Ambiente isolado de análise
    ├── ResearchRunner.ts         # Coordenador de execução
    ├── ResearchStore.ts          # Armazenamento em /research/
    └── index.ts                  # Barrel export
```

## Guardrails Anti-Escrita

### 1. Wrappers ReadOnly

Todos os repositórios são envolvidos em wrappers que bloqueiam escrita:

```typescript
class ReadOnlySituacaoRepository implements SituacaoRepository {
  async getById(id: string): Promise<SituacaoDecisoria | null> {
    return this.inner.getById(id);  // Leitura permitida
  }

  async create(_situacao: SituacaoDecisoria): Promise<void> {
    throw new ResearchWriteForbiddenError('SituacaoRepository.create');
  }
}
```

### 2. Erro Específico

Tentativas de escrita lançam erro identificável:

```typescript
const RESEARCH_WRITE_FORBIDDEN = 'RESEARCH_WRITE_FORBIDDEN';

class ResearchWriteForbiddenError extends Error {
  readonly code = RESEARCH_WRITE_FORBIDDEN;
  // ...
}
```

### 3. Diretório Separado

O `ResearchStore` usa diretório exclusivo:

```
baseDir/
├── tenants/         # Dados do Core (NUNCA tocado)
└── research/        # Relatórios de pesquisa
    └── <tenantId>/
        └── research-xxx.json
```

## Tipos Principais

### ResearchInput

```typescript
interface ResearchInput {
  situacao: SituacaoDecisoria;     // Situação base
  variacoes?: ResearchVariation[]; // Hipóteses alternativas
  modoMemoria: 'OFF' | 'READONLY'; // Acesso à memória
  limitesPesquisa?: ResearchLimits;
}
```

### ResearchVariation

```typescript
interface ResearchVariation {
  id: string;
  descricao?: string;
  alternativas?: Alternativa[];
  incertezas?: string[];
  riscos?: Risco[];
  perfilRisco?: PerfilRisco;
  criteriosMinimos?: string[];
  limitesDefinidos?: Limite[];
  consequenciaRelevante?: string;
}
```

### ResearchReport

```typescript
interface ResearchReport {
  reportId: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  baselineSummary: ResearchBaselineSummary;
  variations: ResearchVariationResult[];
  memorySignals?: ResearchMemorySignals;
  warnings: string[];
  notes: string[];
  limitsApplied: Required<ResearchLimits>;
  truncated: boolean;
  truncationReason?: string;
}
```

## Uso

### Pesquisa Básica (sem variações)

```typescript
import { ResearchRunner, ResearchInput } from './camada-3/pesquisa';

const runner = new ResearchRunner();

const input: ResearchInput = {
  situacao: minhaSituacao,
  modoMemoria: 'OFF'
};

const report = await runner.run(input);
console.log(report.baselineSummary);
```

### Pesquisa com Variações

```typescript
const input: ResearchInput = {
  situacao: minhaSituacao,
  variacoes: [
    { id: 'v1', perfilRisco: PerfilRisco.CONSERVADOR },
    { id: 'v2', perfilRisco: PerfilRisco.AGRESSIVO },
    { id: 'v3', alternativas: [altA, altB, altC] }
  ],
  modoMemoria: 'READONLY',
  limitesPesquisa: { maxVariacoes: 10, maxTempoMs: 30000 }
};

const report = await runner.run(input);

for (const v of report.variations) {
  console.log(`${v.variationId}: ${v.closedLayerBlocks.length} bloqueios`);
}
```

### Persistindo Relatórios

```typescript
import { ResearchStore } from './camada-3/pesquisa';

const store = new ResearchStore('./data', 'tenant-123');
await store.init();

// Salvar
await store.save(report);

// Carregar
const loaded = await store.load(report.reportId);

// Listar
const ids = await store.listReportIds();
```

## Modos de Memória

### OFF (Padrão)

- Não consulta memória institucional
- Isolamento total
- Útil para análise pura de estrutura

### READONLY

- Consulta memória via `MemoryQueryService`
- Apenas métodos `find/get` permitidos
- Retorna `memorySignals` no relatório

## Limites de Execução

```typescript
interface ResearchLimits {
  maxVariacoes?: number;  // Default: 10
  maxTempoMs?: number;    // Default: 30000 (30s)
}
```

Se limites são excedidos:
- `report.truncated = true`
- `report.truncationReason` explica o motivo
- Variações excedentes são ignoradas

## Integração com Camada Fechada

O sandbox roda a Camada Fechada em **modo diagnóstico**:

```typescript
const summary = sandbox.analyzeBaseline(situacao);

if (summary.closedLayerBlocks.length > 0) {
  console.log('Bloqueios detectados:', summary.closedLayerBlocks);
}
```

Isso permite identificar problemas **antes** de tentar registrar uma decisão real.

## Testes

26 testes em `testes/pesquisa/incremento14_research_sandbox.test.ts`:

- **Guardrails Anti-Escrita**: 7 testes
  - Cada repo.create() lança erro
  - Operações de leitura funcionam
- **ResearchSandbox**: 5 testes
  - Baseline gera resumo válido
  - Variações são processadas
  - Bloqueios são detectados
- **ResearchRunner**: 4 testes
  - Report completo é gerado
  - Limites são respeitados
- **ResearchStore**: 5 testes
  - Diretório separado
  - CRUD de relatórios
- **Isolamento do Core**: 2 testes
  - Nenhum arquivo criado no Core
- **Modos de Memória**: 2 testes
- **Erro específico**: 1 teste

## Exemplo de Relatório

```json
{
  "reportId": "research-1703436000000-abc123",
  "startedAt": "2024-12-24T12:00:00.000Z",
  "finishedAt": "2024-12-24T12:00:00.150Z",
  "durationMs": 150,
  "baselineSummary": {
    "situacaoId": "sit-001",
    "dominio": "financeiro",
    "numAlternativas": 2,
    "numRiscos": 1,
    "numIncertezas": 2,
    "temConsequencia": true,
    "closedLayerBlocks": []
  },
  "variations": [
    {
      "variationId": "v1",
      "descricao": "Perfil conservador",
      "riskPosture": "CONSERVADOR",
      "closedLayerBlocks": [
        {
          "blocked": true,
          "rule": "BLOQUEAR_CONSERVADOR_SEM_CRITERIOS",
          "reason": "..."
        }
      ],
      "processingTimeMs": 5
    }
  ],
  "memorySignals": {
    "episodiosRelevantes": ["ep-001", "ep-002"],
    "totalConsultado": 10,
    "modo": "READONLY"
  },
  "warnings": [],
  "notes": ["Baseline analisado: sit-001"],
  "limitsApplied": {
    "maxVariacoes": 10,
    "maxTempoMs": 30000
  },
  "truncated": false
}
```

## Decisões de Design

1. **Por que wrappers ReadOnly?**
   - Garantia em tempo de execução (não só compilação)
   - Erro explícito e rastreável
   - Impossível "esquecer" de usar readonly

2. **Por que diretório separado?**
   - Isolamento físico
   - Fácil limpeza de relatórios
   - Não polui dados do Core

3. **Por que proibir score/ranking?**
   - Libervia não recomenda
   - Pesquisa diagnostica, não otimiza
   - Evita viés de automação

4. **Por que execução sequencial?**
   - Evita race conditions
   - Testes determinísticos
   - Simplicidade > performance aqui

## Changelog

- **v1.0.0** (Incremento 14): Implementação inicial
