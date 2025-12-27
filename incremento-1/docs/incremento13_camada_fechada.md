# INCREMENTO 13 — CAMADA FECHADA (Closed Decision Layer)

## Resumo

A Camada Fechada é um validador puro que bloqueia decisões institucionais quando requisitos mínimos não são atendidos. Funciona como última barreira antes de `RegistrarDecisao`, garantindo que nenhuma decisão inválida seja criada.

## Princípios Fundamentais

- **Função Pura**: Não modifica dados, não persiste nada, não lança exceções inesperadas
- **Código Defensivo**: Usa `?? []` para arrays e `?? ''` para strings
- **Ordem Determinística**: Regras são verificadas sempre na mesma ordem
- **Primeiro Bloqueio**: Retorna imediatamente ao encontrar primeira regra violada
- **Zero Modificações Externas**: Não altera tipos existentes em `tipos.ts`

## Arquitetura

```
camada-3/
└── camada-fechada/
    ├── ClosedLayerTypes.ts    # Interface ClosedLayerResult, ClosedLayerRuleId
    ├── ClosedLayerRules.ts    # 5 funções de validação
    ├── ClosedLayerValidator.ts # validateClosedLayer (função principal)
    └── index.ts               # Barrel export
```

## Regras de Bloqueio

### REGRA 1: BLOQUEAR_SEM_RISCO

**Condição**: `riscos.length === 0 AND incertezas.length === 0`

**Motivo**: Uma decisão sem risco nem incerteza não requer deliberação institucional.

```typescript
// Bloqueia
{ riscos: [], incertezas: [] }

// Passa
{ riscos: [{ descricao: "Risco" }], incertezas: [] }
{ riscos: [], incertezas: ["Incerteza"] }
```

### REGRA 2: BLOQUEAR_SEM_ALTERNATIVAS

**Condição**: `alternativas.length < 2`

**Motivo**: Decisão exige escolha; escolha exige opções.

```typescript
// Bloqueia
{ alternativas: [] }
{ alternativas: [{ descricao: "Única" }] }

// Passa
{ alternativas: [{ descricao: "A" }, { descricao: "B" }] }
```

### REGRA 3: BLOQUEAR_SEM_LIMITES

**Condição**: `limites_definidos.length === 0`

**Motivo**: Toda decisão institucional precisa de limites explícitos.

```typescript
// Bloqueia
{ limites_definidos: [] }

// Passa
{ limites_definidos: [{ tipo: "financeiro", valor: "10000" }] }
```

### REGRA 4: BLOQUEAR_CONSERVADOR_SEM_CRITERIOS

**Condição**: `perfil_risco === CONSERVADOR AND criterios_minimos.length === 0`

**Motivo**: Perfil conservador exige critérios explícitos de avaliação.

```typescript
// Bloqueia
{ perfil_risco: "CONSERVADOR", criterios_minimos: [] }

// Passa
{ perfil_risco: "CONSERVADOR", criterios_minimos: ["Critério"] }
{ perfil_risco: "MODERADO", criterios_minimos: [] }  // OK, não é conservador
```

### REGRA 5: BLOQUEAR_SEM_CONSEQUENCIA

**Condição**: `consequencia_relevante.trim().length === 0`

**Motivo**: Decisão institucional precisa explicitar o que está em jogo.

```typescript
// Bloqueia
{ consequencia_relevante: "" }
{ consequencia_relevante: "   " }

// Passa
{ consequencia_relevante: "Impacto financeiro" }
```

## Interface de Resultado

```typescript
interface ClosedLayerResult {
  blocked: boolean;  // Se deve bloquear
  rule: string;      // ID da regra (vazio se não bloqueado)
  reason: string;    // Motivo legível (vazio se não bloqueado)
}
```

## Identificadores de Regras

```typescript
const ClosedLayerRuleId = {
  SEM_RISCO: 'BLOQUEAR_SEM_RISCO',
  SEM_ALTERNATIVAS: 'BLOQUEAR_SEM_ALTERNATIVAS',
  SEM_LIMITES: 'BLOQUEAR_SEM_LIMITES',
  CONSERVADOR_SEM_CRITERIOS: 'BLOQUEAR_CONSERVADOR_SEM_CRITERIOS',
  SEM_CONSEQUENCIA: 'BLOQUEAR_SEM_CONSEQUENCIA'
} as const;
```

## Integração com OrquestradorCognitivo

A validação ocorre em `RegistrarDecisao`, após verificar que o protocolo está VALIDADO e antes de criar a DecisaoInstitucional:

```typescript
// Em OrquestradorCognitivo.RegistrarDecisao()
const closedLayerResult = validateClosedLayer(situacao, protocolo);
if (closedLayerResult.blocked) {
  throw new Error(
    `Decisão bloqueada pela Camada Fechada. ` +
    `Regra: ${closedLayerResult.rule}. ` +
    `Motivo: ${closedLayerResult.reason}`
  );
}
```

## Uso Direto (Opcional)

Para validação prévia sem chamar o orquestrador:

```typescript
import { validateClosedLayer, ClosedLayerRuleId } from './camada-3';

const result = validateClosedLayer(situacao, protocolo);

if (result.blocked) {
  console.log(`Bloqueado por: ${result.rule}`);
  console.log(`Motivo: ${result.reason}`);
}
```

## Testes

34 testes em `testes/camada-3/incremento13_closed_layer.test.ts`:

- 5 testes por regra individual (incluindo casos defensivos)
- 7 testes para o validador completo
- 3 testes para cenários de borda
- 2 testes para constantes

## Decisões de Design

1. **Por que função pura?**
   - Previsível e testável
   - Sem efeitos colaterais
   - Fácil de raciocinar sobre o comportamento

2. **Por que ordem determinística?**
   - Resultados reproduzíveis
   - Debugging mais simples
   - Testes confiáveis

3. **Por que não lançar exceções nas regras?**
   - Retorno explícito é mais seguro
   - Chamador decide como tratar
   - Evita fluxos de controle obscuros

4. **Por que separar regras do validador?**
   - Cada regra é testável isoladamente
   - Extensibilidade futura (adicionar regras)
   - Código mais legível

## Changelog

- **v1.0.0** (Incremento 13): Implementação inicial com 5 regras
