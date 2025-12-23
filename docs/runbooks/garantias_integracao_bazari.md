# Runbook: Garantias de Integracao Bazari <-> Libervia

**Data**: 2025-12-23
**Versao**: 1.0
**Autor**: Libervia
**Criticidade**: Alta

---

## 1. Visao Geral

Este runbook documenta as garantias de integracao entre Bazari (executor) e Libervia (cerebro institucional), listando verificacoes obrigatorias antes de cada release.

---

## 2. Garantias Fundamentais

### 2.1 Sem Delete/Update em Decisoes

**Descricao**: Decisoes e contratos sao imutaveis. Nenhum repositorio possui metodos para deletar ou atualizar esses registros.

**Verificacao**:
```bash
# Verificar que nao existem metodos delete/update nos repositorios
grep -r "delete\|update" incremento-1/repositorios/implementacao/DecisaoRepositoryImpl.ts
grep -r "delete\|update" incremento-1/repositorios/implementacao/ContratoRepositoryImpl.ts
grep -r "delete\|update" incremento-1/repositorios/implementacao/DecisionProtocolRepositoryImpl.ts

# Resultado esperado: Nenhuma linha retornada
```

**Teste automatizado**:
```bash
npm test -- --testPathPattern=incremento7 --testNamePattern="nao possui metodo delete"
```

### 2.2 Unica Saida = ContratoDeDecisao

**Descricao**: O BazariAdapter retorna APENAS `ContratoDeDecisao`. Nenhum dado interno (episodio, decisao, protocolo) vaza para Bazari.

**Verificacao manual**:
```typescript
// O unico tipo retornado pelo adapter deve ser:
interface ContratoComMetadados {
  contrato: ContratoDeDecisao;
  metadados: MetadadosInteracao;
}
```

**Teste automatizado**:
```bash
npm test -- --testPathPattern=incremento7 --testNamePattern="Resultado nao contem campos internos"
```

### 2.3 Replay Deterministico Pos-Stress

**Descricao**: Apos carga, o EventLog deve manter integridade e replay deve ser deterministico.

**Verificacao**:
```bash
# Executar load test
npm run bazari:load-test 100

# Resultado esperado:
# - STATUS: PASSOU
# - chain_valid: true
# - replay_deterministico: true
```

**Teste automatizado**:
```bash
npm test -- --testPathPattern=incremento7 --testNamePattern="Replay Deterministico"
```

---

## 3. Checklist Pre-Release

### 3.1 Verificacoes Obrigatorias

| # | Verificacao | Comando | Resultado Esperado |
|---|-------------|---------|-------------------|
| 1 | Testes passando | `npm test` | 0 falhas |
| 2 | Incremento 7 OK | `npm test -- --testPathPattern=incremento7` | 28 testes passando |
| 3 | Load test OK | `npm run bazari:load-test 100` | STATUS: PASSOU |
| 4 | Sem delete em DecisaoRepo | `grep delete DecisaoRepositoryImpl.ts` | Sem match |
| 5 | Sem update em ContratoRepo | `grep update ContratoRepositoryImpl.ts` | Sem match |
| 6 | Chain valida | Verificar log do load test | chain_valid: true |
| 7 | Replay deterministico | Verificar log do load test | replay_deterministico: true |

### 3.2 Verificacoes Opcionais

| # | Verificacao | Comando | Notas |
|---|-------------|---------|-------|
| 1 | Cobertura > 60% | `npm run test:coverage` | Verificar statements |
| 2 | Load test N=1000 | `npm run bazari:load-test 1000` | Leva ~2 minutos |

---

## 4. Procedimento de Validacao

### 4.1 Antes do Merge

```bash
# 1. Garantir branch atualizada
git pull origin main

# 2. Instalar dependencias
cd incremento-1
npm install

# 3. Rodar todos os testes
npm test

# 4. Rodar testes do Incremento 7
npm test -- --testPathPattern=incremento7

# 5. Executar load test
npm run bazari:load-test 100

# 6. Verificar resultados
# - Todos os testes devem passar
# - Load test deve reportar STATUS: PASSOU
```

### 4.2 Depois do Merge

```bash
# 1. Verificar CI passou
# 2. Verificar que nao ha warnings novos
# 3. Documentar no relatorio semanal
```

---

## 5. Diagnostico de Falhas

### 5.1 Falha: Testes incremento7 nao passam

**Sintoma**: `npm test -- --testPathPattern=incremento7` falha

**Diagnostico**:
1. Verificar mensagem de erro
2. Verificar se repositorios foram inicializados com `.create()`
3. Verificar se Orquestrador chamou `.init()`

**Acao**:
```bash
# Rodar teste especifico com mais detalhes
npm test -- --testPathPattern=incremento7 --verbose
```

### 5.2 Falha: Load test STATUS: FALHOU

**Sintoma**: `npm run bazari:load-test` reporta falha

**Diagnostico**:
```bash
# Verificar arquivo de resultados
cat data-load-test/load-test-result.json
```

**Possiveis causas**:
- `chain_valid: false` - Corrupcao no EventLog
- `replay_deterministico: false` - Inconsistencia no replay
- `dados_vazados: true` - Vazamento de dados internos
- `taxa_sucesso < 100` - Erros durante processamento

**Acao**:
1. Verificar `erros` no JSON de resultados
2. Se `chain_valid: false`, restaurar backup
3. Se `taxa_sucesso < 100`, analisar erros individuais

### 5.3 Falha: Metodo delete encontrado

**Sintoma**: `grep delete *RepositoryImpl.ts` retorna match

**Diagnostico**: Alguem adicionou metodo de delecao

**Acao**:
1. Identificar commit que adicionou
2. Reverter ou remover metodo
3. Verificar se ha chamadas ao metodo

---

## 6. Monitoramento em Producao

### 6.1 Metricas a Observar

| Metrica | Threshold | Acao |
|---------|-----------|------|
| Taxa de sucesso | < 99% | Investigar erros |
| Tempo medio (ms) | > 500ms | Verificar performance |
| P99 (ms) | > 2000ms | Otimizar ou escalar |
| Chain valid | false | Restaurar backup |

### 6.2 Alertas

```yaml
# Exemplo de alerta (Prometheus/Alertmanager)
- alert: BazariAdapterHighErrorRate
  expr: bazari_adapter_error_rate > 0.01
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Taxa de erro alta no BazariAdapter"
```

---

## 7. Rollback

### 7.1 Quando Fazer Rollback

- Taxa de erro > 5%
- Chain corrompida
- Vazamento de dados detectado

### 7.2 Procedimento

```bash
# 1. Reverter para versao anterior
git revert HEAD

# 2. Restaurar backup do EventLog (se necessario)
# Ver runbook: desastre_backup_frio.md

# 3. Verificar integridade
npm run bazari:load-test 10

# 4. Notificar equipe
```

---

## 8. Contatos

| Papel | Responsavel |
|-------|-------------|
| Arquiteto | (preencher) |
| DevOps | (preencher) |
| DBA | (preencher) |

---

## 9. Historico de Revisoes

| Data | Versao | Autor | Mudancas |
|------|--------|-------|----------|
| 2025-12-23 | 1.0 | Libervia | Versao inicial |

---

*Documento gerado em: 2025-12-23*
