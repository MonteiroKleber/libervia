# Runbook: Operacao Continua do Cerebro Institucional

**Data**: 2025-12-23
**Versao**: 1.0
**Autor**: Libervia
**Criticidade**: Alta

---

## 1. Visao Geral

Este runbook documenta os procedimentos para operacao continua do Cerebro Institucional, incluindo:
- Cadencia de operacoes (drill, backup, metricas)
- Monitoramento e alertas
- Procedimentos de resposta a alertas
- Registro e auditoria

---

## 2. Cadencia de Operacoes

### 2.1 Agenda

| Operacao | Frequencia | Dia/Hora | Comando | Responsavel |
|----------|------------|----------|---------|-------------|
| Drill Go-Live | Quinzenal | Seg 08:00 | `npm run drill:go-live 50` | Ops |
| Backup Frio | Semanal | Dom 02:00 | `npm run backup-frio` | Auto/Ops |
| Dashboard | Diario | 06:00 | `npm run dashboards:generate` | Auto |
| Metricas | Continuo | - | `npm run operacao:metrics` | Auto |

### 2.2 Calendario Exemplo

```
Semana 1: [Drill] [Backup] [Dashboard x7]
Semana 2:         [Backup] [Dashboard x7]
Semana 3: [Drill] [Backup] [Dashboard x7]
Semana 4:         [Backup] [Dashboard x7]
```

---

## 3. Metricas e Thresholds

### 3.1 Tabela de Metricas

| Metrica | Descricao | Warning | Critical | Unidade |
|---------|-----------|---------|----------|---------|
| `drill_tempo` | Duracao do drill | > 120s | > 300s | segundos |
| `chain_valid` | Integridade da chain | false | false | boolean |
| `total_segmentos` | Segmentos do EventLog | > 100 | > 500 | count |
| `total_eventos` | Eventos no EventLog | > 100k | > 500k | count |
| `drill_taxa_sucesso` | Taxa de sucesso do drill | < 100% | < 90% | percent |
| `dias_desde_drill` | Dias desde ultimo drill | > 14 | > 30 | dias |
| `dias_desde_backup` | Dias desde ultimo backup | > 7 | > 14 | dias |

### 3.2 Coleta de Metricas

```bash
# Via CLI
npm run operacao:metrics

# Via API (Control-Plane)
curl http://localhost:3001/metrics/operacao

# Saida em arquivo
npm run operacao:metrics ./data ./test-artifacts/operacao
```

### 3.3 Formato da Saida

```json
{
  "timestamp": "2025-12-23T10:00:00.000Z",
  "status_geral": "OK",
  "eventlog": {
    "total_eventos": 1000,
    "total_segmentos": 10,
    "chain_valid": true
  },
  "drill": {
    "ultimo_drill_timestamp": "2025-12-23T08:00:00.000Z",
    "ultimo_drill_status": "PASSOU",
    "dias_desde_ultimo_drill": 0
  },
  "backup": {
    "ultimo_backup_timestamp": "2025-12-22T02:00:00.000Z",
    "dias_desde_ultimo_backup": 1
  },
  "alertas": []
}
```

---

## 4. Sistema de Alertas

### 4.1 Niveis de Alerta

| Nivel | Acao Imediata | Notificacao |
|-------|---------------|-------------|
| OK | Nenhuma | Log apenas |
| WARNING | Documentar, monitorar | Stdout + Log |
| CRITICAL | Investigar imediatamente | Stdout + Log + Email (futuro) |

### 4.2 Exit Codes

| Codigo | Status | Significado |
|--------|--------|-------------|
| 0 | OK | Todas metricas normais |
| 1 | WARNING | Pelo menos um alerta WARNING |
| 2 | CRITICAL | Pelo menos um alerta CRITICAL |

### 4.3 Exemplo de Alerta

```
════════════════════════════════════════════════════════════════════════════
METRICAS DE OPERACAO CONTINUA
════════════════════════════════════════════════════════════════════════════

ALERTAS:
  [WARNING] Ultimo drill foi ha 15 dias
  [CRITICAL] Ultimo backup foi ha 8 dias

════════════════════════════════════════════════════════════════════════════
STATUS GERAL: CRITICAL
════════════════════════════════════════════════════════════════════════════
```

---

## 5. Procedimentos de Resposta

### 5.1 Alerta: Chain Invalida (CRITICAL)

**Sintoma**: `chain_valid: false`

**Acoes**:
1. Parar novas operacoes
2. Identificar ultimo backup valido
3. Executar restauracao (ver runbook backup_frio)
4. Verificar integridade apos restauracao
5. Investigar causa raiz

### 5.2 Alerta: Drill Atrasado (WARNING/CRITICAL)

**Sintoma**: `dias_desde_ultimo_drill > threshold`

**Acoes**:
1. Executar drill imediatamente: `npm run drill:go-live 50`
2. Verificar resultados
3. Documentar no registro de operacoes
4. Atualizar calendario

### 5.3 Alerta: Backup Atrasado (WARNING/CRITICAL)

**Sintoma**: `dias_desde_ultimo_backup > threshold`

**Acoes**:
1. Executar backup imediatamente: `npm run backup-frio`
2. Verificar `chain_valid_at_backup: true`
3. Documentar no registro de operacoes
4. Verificar automacao (cron)

### 5.4 Alerta: Muitos Segmentos (WARNING/CRITICAL)

**Sintoma**: `total_segmentos > threshold`

**Acoes**:
1. Verificar politica de retencao
2. Considerar prune se aplicavel
3. Analisar crescimento

---

## 6. Registro e Auditoria

### 6.1 Locais de Registro

| Tipo | Local | Retencao |
|------|-------|----------|
| Metricas | `test-artifacts/operacao/<timestamp>/` | 30 dias |
| Drill | `test-artifacts/go-live/<timestamp>/` | 30 dias |
| Backup | `backup-out/` ou configurado | Por politica |

### 6.2 Arquivos por Execucao de Metricas

```
test-artifacts/operacao/<timestamp>/
├── metrics.json      # Metricas completas
├── metrics.log       # Log texto
└── email-payload.json # Payload para notificacao
```

### 6.3 Template de Registro Manual

```markdown
## Execucao [DATA]

**Operador**: [NOME]
**Tipo**: [Drill | Backup | Metricas]
**Comando**: [comando executado]
**Inicio**: [HH:MM]
**Fim**: [HH:MM]
**Status**: [OK | WARNING | CRITICAL]

**Resultados**:
- [resultado 1]
- [resultado 2]

**Alertas**:
- [alerta 1, se houver]

**Acoes Tomadas**:
- [acao 1]
```

---

## 7. Integracao com Control-Plane

### 7.1 Endpoint de Metricas

```bash
# GET /metrics/operacao
curl http://localhost:3001/metrics/operacao
```

### 7.2 Resposta

Retorna objeto `OperacaoMetrics` com:
- Estado do EventLog
- Ultimo drill
- Ultimo backup
- Alertas ativos
- Status geral

### 7.3 Uso para Monitoramento Externo

```bash
# Script de monitoramento
response=$(curl -s http://localhost:3001/metrics/operacao)
status=$(echo $response | jq -r '.status_geral')

if [ "$status" = "CRITICAL" ]; then
  # Enviar alerta
  echo "CRITICAL: Libervia requer atencao"
fi
```

---

## 8. Automacao

### 8.1 Cron Jobs Recomendados

```bash
# /etc/cron.d/libervia-operacao

# Backup semanal (Domingo 02:00)
0 2 * * 0 libervia cd /app/incremento-1 && npm run backup-frio

# Dashboard diario (06:00)
0 6 * * * libervia cd /app/incremento-1 && npm run dashboards:generate

# Metricas a cada hora
0 * * * * libervia cd /app/incremento-1 && npm run operacao:metrics

# Drill quinzenal (Segundas pares, 08:00)
0 8 1,15 * * libervia cd /app/incremento-1 && npm run drill:go-live 50
```

### 8.2 Script de Verificacao

```bash
#!/bin/bash
# verify-operations.sh

cd /app/incremento-1

# Executar metricas
npm run operacao:metrics ./data ./test-artifacts/operacao

# Verificar exit code
if [ $? -eq 2 ]; then
  echo "CRITICAL: Verificar alertas"
  # Notificar equipe
elif [ $? -eq 1 ]; then
  echo "WARNING: Alertas pendentes"
fi
```

---

## 9. Checklist Quinzenal

### 9.1 Antes do Drill

- [ ] Verificar espaco em disco
- [ ] Confirmar backup recente existe
- [ ] Verificar metricas atuais: `npm run operacao:metrics`

### 9.2 Apos o Drill

- [ ] Todos os cenarios passaram?
- [ ] Chain valida final?
- [ ] Adapter funcional?
- [ ] Documentar resultado em `docs/estado/operacao_continua.md`

### 9.3 Revisao Mensal

- [ ] Thresholds adequados?
- [ ] Cadencia suficiente?
- [ ] Alertas dispararam corretamente?
- [ ] Documentacao atualizada?

---

## 10. Contatos

| Papel | Nome | Telefone |
|-------|------|----------|
| Operador Principal | (preencher) | |
| Backup | (preencher) | |
| Escalacao | (preencher) | |

---

## 11. Historico de Revisoes

| Data | Versao | Autor | Mudancas |
|------|--------|-------|----------|
| 2025-12-23 | 1.0 | Libervia | Versao inicial |

---

*Documento gerado em: 2025-12-23*
