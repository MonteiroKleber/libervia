# SLO Definitions — Libervia Gateway

## Visao Geral

Este documento define os Service Level Objectives (SLOs) oficiais do sistema Libervia.
Cada SLO e mensuravel atraves das metricas do Incremento 24 (Telemetria).

---

## SLO-001: API Availability

**Objetivo:** A API deve estar disponivel e respondendo com sucesso.

| Campo | Valor |
|-------|-------|
| **Nome** | API Availability |
| **Objetivo** | >= 99.9% em 30 dias |
| **Metrica** | `libervia_http_requests_total` |
| **Calculo** | `(total - erros_5xx) / total * 100` |
| **Error Budget** | 0.1% (43.2 minutos/mes) |
| **Janela** | 30 dias rolling |

### Formula PromQL

```promql
# Disponibilidade
(
  sum(rate(libervia_http_requests_total{status_code!~"5.."}[30d]))
  /
  sum(rate(libervia_http_requests_total[30d]))
) * 100

# Error budget restante (em minutos)
(0.001 - (
  sum(rate(libervia_http_requests_total{status_code=~"5.."}[30d]))
  /
  sum(rate(libervia_http_requests_total[30d]))
)) * 30 * 24 * 60
```

### Acao ao Violar

1. Verificar Runbook seção PROC-001 (API Fora do Ar)
2. Verificar Runbook seção PROC-003 (Erro 5xx em Massa)
3. Escalar para N2 se nao resolver em 15 minutos

---

## SLO-002: API Latency (p95)

**Objetivo:** 95% das requisicoes devem completar em tempo aceitavel.

| Campo | Valor |
|-------|-------|
| **Nome** | API Latency p95 |
| **Objetivo** | <= 500ms |
| **Metrica** | `libervia_http_request_duration_ms` |
| **Calculo** | Percentil 95 da distribuicao |
| **Threshold Degraded** | > 500ms e <= 1000ms |
| **Threshold Critical** | > 1000ms |
| **Janela** | 5 minutos rolling |

### Formula PromQL

```promql
# p95 latency
histogram_quantile(0.95,
  sum(rate(libervia_http_request_duration_ms_bucket[5m])) by (le)
)

# p99 latency (para referencia)
histogram_quantile(0.99,
  sum(rate(libervia_http_request_duration_ms_bucket[5m])) by (le)
)
```

### Acao ao Violar

1. Verificar Runbook seção PROC-002 (Latência Elevada)
2. Verificar carga do sistema (CPU, memoria, I/O)
3. Identificar rotas mais lentas
4. Escalar horizontalmente se necessario

---

## SLO-003: Error Rate (5xx)

**Objetivo:** Taxa de erros internos deve ser minima.

| Campo | Valor |
|-------|-------|
| **Nome** | Error Rate 5xx |
| **Objetivo** | < 0.1% das requisicoes |
| **Metrica** | `libervia_http_errors_total{error_code="5xx"}` |
| **Calculo** | `erros_5xx / total_requests * 100` |
| **Threshold Warning** | >= 0.1% e < 1% |
| **Threshold Critical** | >= 1% |
| **Janela** | 5 minutos rolling |

### Formula PromQL

```promql
# Taxa de erro 5xx
(
  sum(rate(libervia_http_errors_total{error_code="5xx"}[5m]))
  /
  sum(rate(libervia_http_requests_total[5m]))
) * 100
```

### Acao ao Violar

1. Verificar Runbook seção PROC-003 (Erro 5xx em Massa)
2. Coletar evidencias imediatamente
3. Considerar rollback se taxa > 5%

---

## SLO-004: Authentication Success Rate

**Objetivo:** Requisicoes autenticadas devem ter alta taxa de sucesso.

| Campo | Valor |
|-------|-------|
| **Nome** | Auth Success Rate |
| **Objetivo** | >= 99% para tokens validos |
| **Metrica** | `libervia_auth_failures_total` |
| **Calculo** | `1 - (auth_failures / total_requests_auth)` |
| **Threshold Warning** | < 99% e >= 95% |
| **Threshold Critical** | < 95% |
| **Janela** | 15 minutos rolling |

### Formula PromQL

```promql
# Taxa de falha de autenticacao
sum(rate(libervia_auth_failures_total[15m]))
/
sum(rate(libervia_http_requests_total{route=~"/admin.*|/api.*"}[15m]))
```

### Acao ao Violar

1. Verificar Runbook seção PROC-004 (Falhas de Autenticação)
2. Verificar se tokens foram revogados
3. Verificar se PEPPER foi alterado
4. Investigar possivel ataque se padrao anomalo

---

## SLO-005: Rate Limit Efficiency

**Objetivo:** Rate limiting deve proteger sem impactar usuarios legitimos.

| Campo | Valor |
|-------|-------|
| **Nome** | Rate Limit Efficiency |
| **Objetivo** | < 5% das requisicoes bloqueadas por tenant |
| **Metrica** | `libervia_rate_limited_total` |
| **Calculo** | `rate_limited / total_requests_tenant * 100` |
| **Threshold Warning** | >= 5% e < 20% |
| **Threshold Critical** | >= 20% |
| **Janela** | 1 hora rolling |

### Formula PromQL

```promql
# Taxa de rate limit por tenant
sum(rate(libervia_rate_limited_total[1h])) by (tenant_id)
/
sum(rate(libervia_http_requests_total[1h])) by (tenant_id)
* 100
```

### Acao ao Violar

1. Verificar Runbook seção PROC-006 (Rate Limit Excessivo)
2. Avaliar se limites estao adequados
3. Contatar tenant se uso anomalo

---

## SLO-006: Process Uptime

**Objetivo:** O processo deve manter uptime estavel.

| Campo | Valor |
|-------|-------|
| **Nome** | Process Uptime |
| **Objetivo** | >= 99.9% (excluindo manutencoes programadas) |
| **Metrica** | `libervia_process_uptime_seconds` |
| **Calculo** | Tempo desde ultimo restart |
| **Threshold Warning** | < 1 hora desde ultimo restart |
| **Threshold Critical** | Mais de 3 restarts em 1 hora |
| **Janela** | 1 hora rolling |

### Formula PromQL

```promql
# Uptime atual em horas
libervia_process_uptime_seconds / 3600

# Contador de restarts (via reset do uptime)
changes(libervia_process_uptime_seconds[1h])
```

### Acao ao Violar

1. Verificar Runbook seção PROC-001 (API Fora do Ar)
2. Verificar logs para causa do restart
3. Verificar OOM kills: `dmesg | grep -i oom`
4. Verificar exit codes

---

## SLO-007: Memory Usage

**Objetivo:** Uso de memoria deve permanecer em niveis saudaveis.

| Campo | Valor |
|-------|-------|
| **Nome** | Memory Usage |
| **Objetivo** | Heap usado < 80% do limite |
| **Metrica** | `libervia_process_memory_bytes{type="heap_used"}` |
| **Calculo** | `heap_used / heap_limit * 100` |
| **Threshold Warning** | >= 70% |
| **Threshold Critical** | >= 85% |
| **Janela** | 5 minutos rolling |

### Formula PromQL

```promql
# Uso de heap em MB
libervia_process_memory_bytes{type="heap_used"} / 1024 / 1024

# RSS em MB
libervia_process_memory_bytes{type="rss"} / 1024 / 1024
```

### Acao ao Violar

1. Verificar se ha memory leak
2. Verificar numero de tenants ativos
3. Considerar restart programado
4. Considerar aumento de recursos

---

## SLO-008: Tenant Isolation

**Objetivo:** Conflitos de tenant devem ser zero em operacao normal.

| Campo | Valor |
|-------|-------|
| **Nome** | Tenant Isolation |
| **Objetivo** | 0 conflitos em operacao normal |
| **Metrica** | `libervia_tenant_conflicts_total` |
| **Calculo** | Contador absoluto |
| **Threshold Warning** | > 0 em 1 hora |
| **Threshold Critical** | > 10 em 1 hora |
| **Janela** | 1 hora rolling |

### Formula PromQL

```promql
# Total de conflitos na ultima hora
increase(libervia_tenant_conflicts_total[1h])
```

### Acao ao Violar

1. Verificar Runbook seção PROC-005 (Conflitos de Tenant)
2. Identificar cliente causador
3. Verificar integracao do cliente
4. Contatar cliente para correcao

---

## Resumo de SLOs

| SLO | Objetivo | Metrica Principal | Error Budget |
|-----|----------|-------------------|--------------|
| API Availability | >= 99.9% | http_requests_total | 0.1% |
| API Latency p95 | <= 500ms | http_request_duration_ms | - |
| Error Rate 5xx | < 0.1% | http_errors_total | 0.1% |
| Auth Success | >= 99% | auth_failures_total | 1% |
| Rate Limit | < 5% blocked | rate_limited_total | 5% |
| Process Uptime | >= 99.9% | process_uptime_seconds | 0.1% |
| Memory Usage | < 80% heap | process_memory_bytes | 20% |
| Tenant Isolation | 0 conflicts | tenant_conflicts_total | 0 |

---

## Dashboard Recomendado

### Paineis Essenciais

1. **Disponibilidade (Gauge)**
   - Verde: >= 99.9%
   - Amarelo: >= 99% e < 99.9%
   - Vermelho: < 99%

2. **Latencia p95 (Grafico de linha)**
   - Linha de threshold em 500ms
   - Historico de 24h

3. **Taxa de Erro (Grafico de area)**
   - Separado por 4xx e 5xx
   - Historico de 24h

4. **Error Budget Restante (Gauge)**
   - Mostra minutos restantes no mes

5. **Uso de Memoria (Grafico de linha)**
   - Heap usado vs RSS
   - Linha de threshold em 80%

6. **Tenants Ativos (Contador)**
   - Numero de tenants com requisicoes na ultima hora

---

## Revisao de SLOs

- **Frequencia:** Trimestral
- **Responsavel:** SRE Lead + Product Owner
- **Criterios de Ajuste:**
  - Error budget consistentemente violado
  - Error budget consistentemente nao utilizado
  - Mudancas significativas no produto
  - Feedback de clientes

---

## Changelog

### v25.0.0
- Definicao inicial de 8 SLOs
- Formulas PromQL para cada SLO
- Acoes de violacao documentadas
- Dashboard recomendado
