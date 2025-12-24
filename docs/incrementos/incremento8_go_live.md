# Incremento 8 - Preparacao Go-Live

**Data**: 2025-12-23
**Autor**: Libervia
**Status**: Em Implementacao
**Fase**: 5 - Validacao Pre-Producao

---

## 1. Escopo

O Incremento 8 valida a **prontidao para producao** do Cerebro Institucional, executando:

1. **Cenarios de caos**: Simular falhas e verificar recuperacao
2. **Drill de desastre**: Automatizar sequencia completa de falha/restauracao
3. **Validacao final**: Confirmar garantias apos cenarios adversos
4. **Checklist go-live**: Documentar passos para lancamento

### 1.1 O que NAO esta no escopo

- Mudancas na logica do Orquestrador
- Novas funcionalidades cognitivas
- Deploy em infraestrutura de producao
- Monitoramento externo (Prometheus, Grafana)

---

## 2. Cenarios de Caos

### 2.1 Lista de Cenarios

| # | Cenario | Descricao | Criticidade |
|---|---------|-----------|-------------|
| 1 | Corrupcao de segmento | Corromper arquivo de segmento do EventLog | Alta |
| 2 | Perda de segmento | Remover segmento intermediario | Alta |
| 3 | Corrupcao de snapshot | Corromper event-log-snapshot.json | Media |
| 4 | Requisicoes simultaneas | N chamadas paralelas ao adapter | Media |
| 5 | Restart inesperado | Reiniciar repositorios durante operacao | Media |
| 6 | Disco cheio simulado | Falha de escrita durante append | Baixa |
| 7 | Restauracao de backup | Restaurar backup frio e validar | Alta |

### 2.2 Detalhamento dos Cenarios

#### Cenario 1: Corrupcao de Segmento

**Objetivo**: Verificar que corrupcao e detectada e sistema continua operando em modo degradado.

**Passos**:
1. Gerar N episodios com decisoes
2. Localizar segmento mais antigo
3. Corromper conteudo (alterar bytes)
4. Executar `verifyChain()`
5. Verificar `degraded: true`
6. Confirmar que novas operacoes continuam funcionando

**Metricas**:
- Tempo para detectar corrupcao
- Numero de operacoes bem-sucedidas apos corrupcao

**Criterio de Sucesso**:
- `verifyChain()` retorna `valid: false`
- Status `degraded: true`
- Operacoes continuam (nao bloqueante)

#### Cenario 2: Perda de Segmento

**Objetivo**: Verificar comportamento quando segmento intermediario esta ausente.

**Passos**:
1. Gerar eventos suficientes para criar 3+ segmentos
2. Remover segmento intermediario (ex: segment-000002.json)
3. Executar `verifyChain()`
4. Tentar `replay()`

**Criterio de Sucesso**:
- Sistema detecta inconsistencia
- `replay()` reporta erro ou dados parciais

#### Cenario 3: Corrupcao de Snapshot

**Objetivo**: Verificar que corrupcao de snapshot nao impede operacoes.

**Passos**:
1. Gerar eventos e snapshot
2. Corromper snapshot
3. Reiniciar EventLog
4. Verificar comportamento

**Criterio de Sucesso**:
- Sistema ignora snapshot corrompido
- Reconstroi estado a partir de segmentos

#### Cenario 4: Requisicoes Simultaneas

**Objetivo**: Verificar comportamento sob carga paralela.

**Passos**:
1. Criar N promises de `solicitarDecisao()`
2. Executar todas em paralelo (`Promise.all`)
3. Verificar que todos os contratos foram gerados
4. Verificar integridade do EventLog

**Metricas**:
- Taxa de sucesso
- Tempo medio por requisicao
- Conflitos de escrita

**Criterio de Sucesso**:
- 100% de sucesso
- Sem corrupcao de dados
- Chain valida apos carga

#### Cenario 5: Restart Inesperado

**Objetivo**: Verificar recuperacao apos reinicio.

**Passos**:
1. Iniciar operacoes
2. Simular "crash" (descartar instancias em memoria)
3. Recriar repositorios a partir do disco
4. Verificar estado consistente

**Criterio de Sucesso**:
- Dados persistidos estao intactos
- Operacoes podem continuar

#### Cenario 6: Disco Cheio Simulado

**Objetivo**: Verificar graceful degradation quando escrita falha.

**Passos**:
1. Mockar `fs.writeFile` para lancar erro
2. Tentar operacao
3. Verificar que erro e capturado
4. Sistema entra em modo degradado

**Criterio de Sucesso**:
- Erro nao propaga (sistema nao crasha)
- Status `degraded: true`
- Log de erro registrado

#### Cenario 7: Restauracao de Backup

**Objetivo**: Validar fluxo completo de backup/restauracao.

**Passos**:
1. Gerar dados (situacoes, decisoes, contratos)
2. Executar backup frio
3. Modificar/corromper dados originais
4. Restaurar do backup
5. Verificar integridade
6. Executar operacao via adapter

**Criterio de Sucesso**:
- Dados restaurados corretamente
- `verifyChain()` retorna `valid: true`
- Adapter funciona apos restauracao

---

## 3. Mapeamento para Scripts Existentes

| Script | Uso no Drill |
|--------|--------------|
| `backup-frio` | Criar pacote de backup antes de caos |
| `control-plane:start` | Verificar health apos cenarios |
| `bazari:load-test` | Gerar carga para cenario 4 |
| `dashboards:generate` | Capturar estado pre/pos caos |

---

## 4. Garantias Fundamentais

O drill deve validar que as garantias continuam validas apos cada cenario:

### 4.1 Sem Delete/Update

```typescript
// Verificar que repositorios nao possuem metodos proibidos
expect(decisaoRepo.delete).toBeUndefined();
expect(decisaoRepo.update).toBeUndefined();
expect(contratoRepo.delete).toBeUndefined();
expect(contratoRepo.update).toBeUndefined();
```

### 4.2 Replay Deterministico

```typescript
// Dois replays consecutivos devem ser identicos
const replay1 = await eventLog.replay();
const replay2 = await eventLog.replay();
expect(replay1.totalEventos).toBe(replay2.totalEventos);
expect(JSON.stringify(replay1.porEvento)).toBe(JSON.stringify(replay2.porEvento));
```

### 4.3 Unica Saida = ContratoDeDecisao

```typescript
// Adapter retorna apenas contrato
const resultado = await adapter.solicitarDecisao(situacao, protocolo);
expect(resultado.contrato).toBeDefined();
expect(resultado.contrato.emitido_para).toBe('Bazari');
```

---

## 5. Script de Drill

### 5.1 Comando

```bash
npm run drill:go-live [N_EPISODIOS] [OUTPUT_DIR]

# Exemplo
npm run drill:go-live 50 ./test-artifacts/go-live
```

### 5.2 Saida

```
./test-artifacts/go-live/<timestamp>/
├── drill-result.json       # Resultado consolidado
├── pre-chaos-manifest.json # Estado antes do caos
├── post-chaos-manifest.json # Estado apos restauracao
├── logs/
│   ├── scenario-1.log
│   ├── scenario-2.log
│   └── ...
└── metrics/
    ├── timing.json
    └── summary.md
```

### 5.3 Formato do Resultado

```typescript
interface DrillResult {
  timestamp: string;
  duracao_total_ms: number;
  cenarios: Array<{
    id: number;
    nome: string;
    status: 'PASSOU' | 'FALHOU' | 'PULADO';
    duracao_ms: number;
    metricas: Record<string, number>;
    erro?: string;
  }>;
  garantias: {
    sem_delete_update: boolean;
    replay_deterministico: boolean;
    adapter_funcional: boolean;
    chain_valida_final: boolean;
  };
  sumario: {
    total_cenarios: number;
    passou: number;
    falhou: number;
    pulados: number;
  };
}
```

---

## 6. Testes Automatizados

### 6.1 Cobertura

| Teste | Descricao |
|-------|-----------|
| Drill modo fast | Executa subset de cenarios |
| Garantias pos-drill | Verifica integridade |
| Replay deterministico | Compara antes/depois |
| Adapter funcional | Chamada bem-sucedida |

### 6.2 Integracao com Suite Existente

```bash
# Rodar todos os testes incluindo drill
npm test

# Apenas testes do Incremento 8
npm test -- --testPathPattern=incremento8
```

---

## 7. Criterios de Go-Live

### 7.1 Obrigatorios

| Criterio | Verificacao |
|----------|-------------|
| Todos os testes passam | `npm test` = 0 falhas |
| Drill passa | Todos cenarios OK |
| Chain valida | `verifyChain()` = true |
| Replay deterministico | Comparacao OK |
| Backup funcional | Restauracao OK |
| Adapter funcional | Contrato emitido |

### 7.2 Recomendados

| Criterio | Verificacao |
|----------|-------------|
| Cobertura > 60% | `npm run test:coverage` |
| Load test N=1000 OK | `npm run bazari:load-test 1000` |
| Dashboard gerado | `npm run dashboards:generate` |

---

## 8. Rollback

Se algum criterio falhar:

1. Identificar cenario que falhou
2. Analisar logs em `test-artifacts/go-live/`
3. Corrigir issue
4. Re-executar drill
5. Documentar em `docs/estado/semana8_go_live.md`

---

## 9. Checklist de Implementacao

- [ ] Criar `scripts/drill_go_live.ts`
- [ ] Adicionar npm script `drill:go-live`
- [ ] Criar `testes/incremento8.test.ts`
- [ ] Criar `docs/runbooks/checklist_go_live.md`
- [ ] Atualizar documentacao canonica
- [ ] Criar `docs/estado/semana8_go_live.md`
- [ ] Executar drill completo
- [ ] Validar resultados

---

*Documento criado em: 2025-12-23*
*Versao: 8.0*
