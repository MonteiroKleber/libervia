# INC 15.9 — Higiene de FS: Eliminação de Race Condition em EventLog

## Resumo

Este incremento corrige um flaky test em `incremento4_2.test.ts` causado por race condition na função `_corruptEntry` do EventLog.

## Problema Identificado

### Sintoma
O teste "Corrupção entre segmentos é detectada" falhava intermitentemente.

### Causa Raiz
O método `_corruptEntry` era chamado sem `await`, causando race condition:

```typescript
// ANTES (incorreto - fire-and-forget)
eventLog._corruptEntry(3, 'previous_hash', 'CORRUPTED_HASH');
await new Promise(resolve => setTimeout(resolve, 50)); // Hack para esperar
```

O método era `async` mas o caller não aguardava sua conclusão, fazendo com que `verifyChainFull()` fosse chamado antes da corrupção ser aplicada.

## Solução

### 1. Garantir que `_corruptEntry` é async e awaitable

```typescript
// EventLogRepositoryImpl.ts
async _corruptEntry(index: number, field: keyof EventLogEntry, value: any): Promise<void> {
  const all = await this.getAll();

  if (index < 0 || index >= all.length) {
    throw new Error(`Invalid index ${index}, total events: ${all.length}`);
  }

  (all[index] as any)[field] = value;
  this.allEntriesCache = all;

  // Se o evento está no segmento atual, também corromper lá
  const eventsInPreviousSegments = this.totalEvents - this.currentSegmentEntries.length;
  if (index >= eventsInPreviousSegments) {
    const localIndex = index - eventsInPreviousSegments;
    if (localIndex >= 0 && localIndex < this.currentSegmentEntries.length) {
      (this.currentSegmentEntries[localIndex] as any)[field] = value;
    }
  }
}
```

### 2. Adicionar `await` em todas as chamadas

```typescript
// DEPOIS (correto)
await eventLog._corruptEntry(3, 'previous_hash', 'CORRUPTED_HASH');
// Sem setTimeout - operação é síncrona após o await
```

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `camada-3/event-log/EventLogRepositoryImpl.ts` | `_corruptEntry` retorna `Promise<void>` explicitamente |
| `testes/incremento4.test.ts` | 4 chamadas agora com `await` |
| `testes/incremento4_1.test.ts` | 1 chamada agora com `await` |
| `testes/incremento4_2.test.ts` | 1 chamada agora com `await`, removido setTimeout hack |
| `testes/incremento4_3.test.ts` | 2 chamadas agora com `await` |

## Validação

```bash
# Executar 2x consecutivas sem falhas
npx jest --testPathPattern=incremento4_2
npx jest --testPathPattern=incremento4_2
```

Ambas as execuções devem passar com 18/18 testes, incluindo "Corrupção entre segmentos é detectada".

## Lições Aprendidas

1. **Sempre awaitar métodos async** - Métodos que retornam `Promise` devem ser awaited, mesmo em código de teste.

2. **Evitar setTimeout como workaround** - Se precisar de setTimeout para sincronização, provavelmente há um await faltando.

3. **Métodos de debug também precisam de cuidado** - Mesmo métodos marcados como `@internal` ou `_prefixados` devem ter sua assinatura async correta.

## Princípio

> **Fire-and-forget é fonte de flakiness**
>
> Toda operação que modifica estado deve ser awaited antes de verificar o resultado.
