# Alerting Rules — Libervia Gateway

## Visao Geral

Este documento define as regras de alerta oficiais para o sistema Libervia.
Todas as regras sao baseadas nas metricas do Incremento 24 (Telemetria).

---

## Formato das Regras

Cada regra segue o formato:

```yaml
- alert: NOME_DO_ALERTA
  expr: <expressao-promql>
  for: <duracao>
  labels:
    severity: <INFO|WARN|CRITICAL>
  annotations:
    summary: "Descricao curta"
    description: "Descricao detalhada"
    runbook: "Link para procedimento"
```

---

## ALERT-001: API_DOWN

**Descricao:** API nao esta respondendo ou health check falha.

```yaml
- alert: API_DOWN
  expr: up{job="libervia"} == 0
  for: 1m
  labels:
    severity: CRITICAL
  annotations:
    summary: "Libervia API esta fora do ar"
    description: "O endpoint de health check nao responde ha mais de 1 minuto."
    runbook: "docs/runbook_operacional.md#proc-001-api-fora-do-ar"
```

### Alternativa (baseada em metricas)

```yaml
- alert: API_DOWN_NO_REQUESTS
  expr: |
    sum(rate(libervia_http_requests_total[5m])) == 0
    and
    libervia_process_uptime_seconds > 300
  for: 2m
  labels:
    severity: CRITICAL
  annotations:
    summary: "API nao esta recebendo requisicoes"
    description: "Nenhuma requisicao recebida nos ultimos 5 minutos, mas processo esta rodando ha mais de 5 minutos."
    runbook: "docs/runbook_operacional.md#proc-001-api-fora-do-ar"
```

| Campo | Valor |
|-------|-------|
| Severidade | CRITICAL |
| Acao | Verificar processo, reiniciar se necessario |
| Runbook | PROC-001 |
| SLO Relacionado | SLO-001 (API Availability) |

---

## ALERT-002: HIGH_LATENCY

**Descricao:** Latencia p95 acima do threshold aceitavel.

```yaml
- alert: HIGH_LATENCY_WARNING
  expr: |
    histogram_quantile(0.95,
      sum(rate(libervia_http_request_duration_ms_bucket[5m])) by (le)
    ) > 500
  for: 5m
  labels:
    severity: WARN
  annotations:
    summary: "Latencia p95 elevada (> 500ms)"
    description: "A latencia p95 esta acima de 500ms nos ultimos 5 minutos."
    runbook: "docs/runbook_operacional.md#proc-002-latencia-elevada"

- alert: HIGH_LATENCY_CRITICAL
  expr: |
    histogram_quantile(0.95,
      sum(rate(libervia_http_request_duration_ms_bucket[5m])) by (le)
    ) > 1000
  for: 2m
  labels:
    severity: CRITICAL
  annotations:
    summary: "Latencia p95 critica (> 1000ms)"
    description: "A latencia p95 esta acima de 1 segundo nos ultimos 2 minutos."
    runbook: "docs/runbook_operacional.md#proc-002-latencia-elevada"
```

| Campo | Valor |
|-------|-------|
| Severidade | WARN (>500ms) / CRITICAL (>1000ms) |
| Acao | Verificar carga, escalar se necessario |
| Runbook | PROC-002 |
| SLO Relacionado | SLO-002 (API Latency p95) |

---

## ALERT-003: ERROR_RATE_SPIKE

**Descricao:** Taxa de erros 5xx acima do aceitavel.

```yaml
- alert: ERROR_RATE_SPIKE_WARNING
  expr: |
    (
      sum(rate(libervia_http_errors_total{error_code="5xx"}[5m]))
      /
      sum(rate(libervia_http_requests_total[5m]))
    ) * 100 > 0.1
  for: 2m
  labels:
    severity: WARN
  annotations:
    summary: "Taxa de erro 5xx elevada (> 0.1%)"
    description: "A taxa de erros 5xx esta acima de 0.1% nos ultimos 2 minutos."
    runbook: "docs/runbook_operacional.md#proc-003-erro-5xx-em-massa"

- alert: ERROR_RATE_SPIKE_CRITICAL
  expr: |
    (
      sum(rate(libervia_http_errors_total{error_code="5xx"}[5m]))
      /
      sum(rate(libervia_http_requests_total[5m]))
    ) * 100 > 1
  for: 1m
  labels:
    severity: CRITICAL
  annotations:
    summary: "Taxa de erro 5xx critica (> 1%)"
    description: "A taxa de erros 5xx esta acima de 1% no ultimo minuto. Considerar rollback."
    runbook: "docs/runbook_operacional.md#proc-003-erro-5xx-em-massa"
```

| Campo | Valor |
|-------|-------|
| Severidade | WARN (>0.1%) / CRITICAL (>1%) |
| Acao | Investigar causa, considerar rollback |
| Runbook | PROC-003 |
| SLO Relacionado | SLO-003 (Error Rate 5xx) |

---

## ALERT-004: AUTH_FAILURE_SPIKE

**Descricao:** Aumento anormal de falhas de autenticacao.

```yaml
- alert: AUTH_FAILURE_SPIKE_WARNING
  expr: |
    sum(rate(libervia_auth_failures_total[5m])) > 1
  for: 5m
  labels:
    severity: WARN
  annotations:
    summary: "Falhas de autenticacao elevadas"
    description: "Mais de 1 falha de autenticacao por segundo nos ultimos 5 minutos."
    runbook: "docs/runbook_operacional.md#proc-004-falhas-de-autenticacao"

- alert: AUTH_FAILURE_SPIKE_CRITICAL
  expr: |
    sum(rate(libervia_auth_failures_total[5m])) > 10
  for: 2m
  labels:
    severity: CRITICAL
  annotations:
    summary: "Falhas de autenticacao criticas - possivel ataque"
    description: "Mais de 10 falhas de autenticacao por segundo. Possivel tentativa de brute force."
    runbook: "docs/runbook_operacional.md#proc-004-falhas-de-autenticacao"
```

| Campo | Valor |
|-------|-------|
| Severidade | WARN (>1/s) / CRITICAL (>10/s) |
| Acao | Investigar origem, considerar bloqueio de IP |
| Runbook | PROC-004 |
| SLO Relacionado | SLO-004 (Auth Success Rate) |

---

## ALERT-005: TENANT_CONFLICT_SPIKE

**Descricao:** Conflitos de tenant detectados.

```yaml
- alert: TENANT_CONFLICT_DETECTED
  expr: |
    increase(libervia_tenant_conflicts_total[1h]) > 0
  for: 0m
  labels:
    severity: WARN
  annotations:
    summary: "Conflito de tenant detectado"
    description: "Um ou mais conflitos de tenant foram detectados na ultima hora."
    runbook: "docs/runbook_operacional.md#proc-005-conflitos-de-tenant"

- alert: TENANT_CONFLICT_SPIKE
  expr: |
    increase(libervia_tenant_conflicts_total[1h]) > 10
  for: 0m
  labels:
    severity: CRITICAL
  annotations:
    summary: "Multiplos conflitos de tenant"
    description: "Mais de 10 conflitos de tenant na ultima hora. Investigar integracao do cliente."
    runbook: "docs/runbook_operacional.md#proc-005-conflitos-de-tenant"
```

| Campo | Valor |
|-------|-------|
| Severidade | WARN (>0) / CRITICAL (>10) |
| Acao | Identificar cliente, verificar integracao |
| Runbook | PROC-005 |
| SLO Relacionado | SLO-008 (Tenant Isolation) |

---

## ALERT-006: RATE_LIMIT_ABUSE

**Descricao:** Tenant atingindo rate limit frequentemente.

```yaml
- alert: RATE_LIMIT_ABUSE_WARNING
  expr: |
    (
      sum(rate(libervia_rate_limited_total[1h])) by (tenant_id)
      /
      sum(rate(libervia_http_requests_total[1h])) by (tenant_id)
    ) * 100 > 5
  for: 30m
  labels:
    severity: WARN
  annotations:
    summary: "Tenant atingindo rate limit frequentemente"
    description: "Tenant {{ $labels.tenant_id }} tem mais de 5% das requisicoes bloqueadas por rate limit."
    runbook: "docs/runbook_operacional.md#proc-006-rate-limit-excessivo"

- alert: RATE_LIMIT_ABUSE_CRITICAL
  expr: |
    (
      sum(rate(libervia_rate_limited_total[1h])) by (tenant_id)
      /
      sum(rate(libervia_http_requests_total[1h])) by (tenant_id)
    ) * 100 > 20
  for: 15m
  labels:
    severity: CRITICAL
  annotations:
    summary: "Tenant abusando de rate limit"
    description: "Tenant {{ $labels.tenant_id }} tem mais de 20% das requisicoes bloqueadas. Considerar suspensao."
    runbook: "docs/runbook_operacional.md#proc-006-rate-limit-excessivo"
```

| Campo | Valor |
|-------|-------|
| Severidade | WARN (>5%) / CRITICAL (>20%) |
| Acao | Contatar tenant, avaliar quota |
| Runbook | PROC-006 |
| SLO Relacionado | SLO-005 (Rate Limit Efficiency) |

---

## ALERT-007: MEMORY_PRESSURE

**Descricao:** Uso de memoria em niveis preocupantes.

```yaml
- alert: MEMORY_PRESSURE_WARNING
  expr: |
    libervia_process_memory_bytes{type="heap_used"} > 500000000
  for: 10m
  labels:
    severity: WARN
  annotations:
    summary: "Uso de memoria heap elevado (> 500MB)"
    description: "O heap usado esta acima de 500MB nos ultimos 10 minutos."
    runbook: "docs/runbook_operacional.md#proc-002-latencia-elevada"

- alert: MEMORY_PRESSURE_CRITICAL
  expr: |
    libervia_process_memory_bytes{type="heap_used"} > 800000000
  for: 5m
  labels:
    severity: CRITICAL
  annotations:
    summary: "Uso de memoria heap critico (> 800MB)"
    description: "O heap usado esta acima de 800MB. Risco de OOM."
    runbook: "docs/runbook_operacional.md#proc-001-api-fora-do-ar"
```

| Campo | Valor |
|-------|-------|
| Severidade | WARN (>500MB) / CRITICAL (>800MB) |
| Acao | Verificar memory leaks, considerar restart |
| Runbook | PROC-001, PROC-002 |
| SLO Relacionado | SLO-007 (Memory Usage) |

---

## ALERT-008: INSTANCE_RESTART_LOOP

**Descricao:** Processo reiniciando frequentemente.

```yaml
- alert: INSTANCE_RESTART_LOOP
  expr: |
    changes(libervia_process_uptime_seconds[1h]) > 3
  for: 0m
  labels:
    severity: CRITICAL
  annotations:
    summary: "Processo reiniciando em loop"
    description: "O processo reiniciou mais de 3 vezes na ultima hora."
    runbook: "docs/runbook_operacional.md#proc-001-api-fora-do-ar"

- alert: INSTANCE_JUST_RESTARTED
  expr: |
    libervia_process_uptime_seconds < 300
  for: 0m
  labels:
    severity: INFO
  annotations:
    summary: "Processo reiniciou recentemente"
    description: "O processo esta rodando ha menos de 5 minutos."
    runbook: "docs/runbook_operacional.md#checklist-de-startup"
```

| Campo | Valor |
|-------|-------|
| Severidade | INFO (restart recente) / CRITICAL (loop) |
| Acao | Verificar logs, identificar causa |
| Runbook | PROC-001 |
| SLO Relacionado | SLO-006 (Process Uptime) |

---

## Resumo de Alertas

| Alerta | Severidade | Metrica | Threshold |
|--------|------------|---------|-----------|
| API_DOWN | CRITICAL | up / http_requests_total | 0 requests |
| HIGH_LATENCY | WARN/CRITICAL | http_request_duration_ms | 500ms/1000ms |
| ERROR_RATE_SPIKE | WARN/CRITICAL | http_errors_total | 0.1%/1% |
| AUTH_FAILURE_SPIKE | WARN/CRITICAL | auth_failures_total | 1/s / 10/s |
| TENANT_CONFLICT_SPIKE | WARN/CRITICAL | tenant_conflicts_total | 1/10 por hora |
| RATE_LIMIT_ABUSE | WARN/CRITICAL | rate_limited_total | 5%/20% |
| MEMORY_PRESSURE | WARN/CRITICAL | process_memory_bytes | 500MB/800MB |
| INSTANCE_RESTART_LOOP | CRITICAL | process_uptime_seconds | 3 restarts/hora |

---

## Configuracao no Prometheus

### prometheus.yml

```yaml
rule_files:
  - '/etc/prometheus/rules/libervia-alerts.yml'

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
```

### libervia-alerts.yml

```yaml
groups:
  - name: libervia.rules
    rules:
      # Copiar regras acima
```

---

## Roteamento no Alertmanager

### alertmanager.yml

```yaml
route:
  receiver: 'default'
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

  routes:
    - match:
        severity: CRITICAL
      receiver: 'pagerduty-critical'
      continue: true

    - match:
        severity: WARN
      receiver: 'slack-warnings'

    - match:
        severity: INFO
      receiver: 'slack-info'

receivers:
  - name: 'default'
    email_configs:
      - to: 'ops@example.com'

  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '<PD_SERVICE_KEY>'

  - name: 'slack-warnings'
    slack_configs:
      - api_url: '<SLACK_WEBHOOK_URL>'
        channel: '#libervia-alerts'
        title: 'Warning: {{ .GroupLabels.alertname }}'

  - name: 'slack-info'
    slack_configs:
      - api_url: '<SLACK_WEBHOOK_URL>'
        channel: '#libervia-info'
```

---

## Silenciamento

### Manutencao Programada

```bash
# Criar silenciamento via API
curl -X POST http://alertmanager:9093/api/v1/silences \
  -d '{
    "matchers": [
      {"name": "job", "value": "libervia", "isRegex": false}
    ],
    "startsAt": "2025-01-01T00:00:00Z",
    "endsAt": "2025-01-01T02:00:00Z",
    "createdBy": "ops-team",
    "comment": "Manutencao programada"
  }'
```

---

## Changelog

### v25.0.0
- 8 alertas canonicos definidos
- Configuracao de Prometheus e Alertmanager
- Roteamento por severidade
- Procedimento de silenciamento
