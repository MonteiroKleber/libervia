# INCREMENTO 27 — Chaos Engineering & Institutional Stress Tests

## O que é Chaos Engineering no Contexto da Libervia

Chaos Engineering é a disciplina de experimentar em um sistema para construir confiança na capacidade do sistema de suportar condições turbulentas em produção.

No contexto da Libervia, Chaos Engineering valida que o **Cérebro Institucional (camada-3)**:

1. **Não perde identidade sob falha** — O estado institucional permanece íntegro
2. **Não entra em estados inválidos** — Constraints estruturais são mantidas
3. **Reage conforme procedimentos canônicos** — Runbook (Inc 25) e DR (Inc 26) funcionam

### Princípios Fundamentais

- **Falhas são explícitas** — Injeção controlada, não simulação vaga
- **Toda falha relevante gera evento auditável** — EventLog captura tudo
- **Testes provam comportamento, não "mockam sucesso"** — Falha real → recuperação real
- **Código de chaos é exclusivo para testes** — NUNCA importado pelo core

---

## Por que Falha ≠ Bug

| Aspecto | Falha | Bug |
|---------|-------|-----|
| **Origem** | Ambiente/infraestrutura | Código incorreto |
| **Previsibilidade** | Esperada em sistemas distribuídos | Não deveria existir |
| **Tratamento** | Recovery procedures | Correção de código |
| **Exemplo** | Disco cheio, rede timeout | Null pointer, lógica errada |

### Falhas são Inevitáveis

Em sistemas do mundo real:
- Discos falham (MTBF ~1M horas)
- Redes particionam (falhas de DC)
- Processos crasham (OOM, signals)
- Arquivos corrompem (bit rot, escrita parcial)

A questão não é **se** vai falhar, mas **como o sistema se comporta quando falha**.

### O que Chaos Engineering Prova

1. **Resiliência** — Sistema recupera automaticamente
2. **Consistência** — Estado permanece válido após falha
3. **Auditabilidade** — Toda falha é registrada
4. **Procedimentos** — Runbook/DR funcionam na prática

---

## Tabela de Falhas Simuladas

| Falha Simulada | Comportamento Esperado | Garantia Institucional Validada |
|----------------|------------------------|--------------------------------|
| **FILESYSTEM_WRITE** — Escrita falha durante persist | Operação aborta, sem estado parcial, .tmp cleanup | Atomicidade de persistência |
| **FILESYSTEM_READ** — Leitura falha durante restore | Restore falha gracefully, estado anterior preservado | Imutabilidade do estado atual |
| **CORRUPTION_PARTIAL** — Hash/signature inválido | Backup rejeitado com RESTORE_REJECTED | Integridade criptográfica |
| **CORRUPTION_TOTAL** — JSON ilegível | Parse falha, backup descartado | Validação de formato |
| **SNAPSHOT_LOSS** — Arquivo de snapshot deletado | Reconstrução a partir do EventLog | Durabilidade via event sourcing |
| **PERSIST_INTERRUPT** — Crash durante escrita atômica | .tmp órfão, cleanup no restart | Write-ahead pattern |
| **RESTORE_INTERRUPT** — Crash durante restore | Restore incompleto detectado | Transacionalidade |
| **Race Condition** — Múltiplas escritas simultâneas | Serialização, sem dados perdidos | Concurrency control |
| **Mandato Crítico** — Falha durante consumo de uses | Uses não consumidos se commit falha | Atomicidade de transação |

---

## Cenários de Teste Obrigatórios

### 4.1 Falha Durante Persistência
```
DADO: JsonFileStore persistindo entidade
QUANDO: writeFile falha mid-operation
ENTÃO: Nenhum arquivo parcial permanece
E: Estado anterior do repositório intacto
E: Evento de erro registrado (se aplicável)
```

### 4.2 Corrupção de Snapshot
```
DADO: Backup snapshot com hash válido
QUANDO: Arquivo corrompido (hash, signature, ou data)
ENTÃO: verifyBackupIntegrity retorna false
E: RestoreService rejeita backup
E: Evento RESTORE_REJECTED registrado
```

### 4.3 Restore em Ambiente Sujo
```
DADO: Sistema com dados existentes
QUANDO: Tentativa de restore
ENTÃO: Operação recusada (append-only, sem overwrite)
E: Dados existentes intactos
E: Evento de rejeição registrado
```

### 4.4 Falha no Meio de Operação
```
DADO: Transação multi-step em andamento
QUANDO: Exception no step N
ENTÃO: Nenhum estado parcial persiste
E: Steps anteriores não commitados são revertidos
```

### 4.5 Falha Concorrente (Race Condition)
```
DADO: 10 operações de escrita simultâneas
QUANDO: Executadas em paralelo
ENTÃO: Todas completam ou falham explicitamente
E: Nenhum dado corrompido
E: Ordem preservada (se aplicável)
```

### 4.6 Falha em Mandato Crítico
```
DADO: AgenteInterno com mandato ativo (uses restantes)
QUANDO: Operação falha antes de commit
ENTÃO: Uses NÃO são consumidos
E: Mandato permanece válido para retry
```

---

## Relação com Incrementos Anteriores

### Runbook Operacional (Incremento 25)

O Runbook define procedimentos para situações operacionais. Chaos Engineering valida que:

| Procedimento | Validação Chaos |
|--------------|-----------------|
| Restart após crash | Estado recupera corretamente |
| Cleanup de .tmp | Arquivos órfãos são removidos |
| Verificação de integridade | Corrupção é detectada |
| Alertas de falha | Eventos são registrados |

### DR Procedures (Incremento 26)

O módulo de Backup/Restore/DR é validado sob falha:

| Procedimento DR | Validação Chaos |
|-----------------|-----------------|
| Backup creation | Resiliente a I/O failure |
| Backup verification | Detecta qualquer corrupção |
| Restore validation | Rejeita backups inválidos |
| Disaster recovery | Funciona com ambiente limpo |

---

## Implementação Técnica

### ChaosInjector

```typescript
// EXCLUSIVO PARA TESTES - nunca importar no core
import { ChaosInjector } from './chaos/ChaosInjector';

const chaos = new ChaosInjector();
chaos.activate();
chaos.enable('FILESYSTEM_WRITE', { failCount: 2 });

// Próximas 2 escritas falharão
await chaos.maybeFailWrite('test.json');
```

### Tipos de Falha Suportados

- `FILESYSTEM_WRITE` — Falha em fs.writeFile
- `FILESYSTEM_READ` — Falha em fs.readFile
- `FILESYSTEM_RENAME` — Falha em fs.rename
- `CORRUPTION_PARTIAL` — Corrompe hash/signature/data
- `CORRUPTION_TOTAL` — Arquivo ilegível
- `SNAPSHOT_LOSS` — Deleta arquivo
- `PERSIST_INTERRUPT` — Crash durante persistência
- `RESTORE_INTERRUPT` — Crash durante restore
- `NETWORK_TIMEOUT` — Simula timeout de rede
- `RANDOM_EXCEPTION` — Exception genérica

### Helpers para Testes

```typescript
// Executa operações concorrentes
await runConcurrently([op1, op2, op3]);

// Replica operação N vezes
const ops = replicateOperation(() => write(), 10);

// Verifica que operação falha com ChaosError
await expectChaosFailure(() => op(), 'FILESYSTEM_WRITE');

// Verifica ausência de arquivos órfãos
await assertNoOrphanTmpFiles(directory);

// Verifica JSON válido
await assertValidJson(filePath);
```

---

## Critérios de Aceite

- [ ] ChaosInjector é TEST-ONLY (não importado pelo core)
- [ ] Todos os 6 cenários obrigatórios passam
- [ ] Nenhum estado parcial persiste após falha
- [ ] EventLog registra falhas relevantes
- [ ] Backups corrompidos são rejeitados
- [ ] Race conditions não corrompem dados
- [ ] Uses de mandato são preservados em falha
- [ ] Documentação completa com tabela de falhas

---

## Conclusão

Chaos Engineering no contexto da Libervia não é sobre "quebrar coisas" — é sobre **provar que o Cérebro Institucional mantém suas garantias mesmo sob adversidade**.

Cada teste de falha é uma validação de que:
1. O design é robusto
2. Os procedimentos funcionam
3. A instituição permanece íntegra

> "A melhor forma de ter confiança em um sistema é forçá-lo a falhar de forma controlada e observar sua recuperação."
