# Incremento 24 — Telemetria & Métricas (Production Observability v1)

## Visão Geral

Este incremento implementa observabilidade de produção para o gateway Libervia:
- Métricas HTTP (latência, status, throughput) com correlação por tenant
- Métricas de runtime (instâncias ativas, uso de memória)
- Métricas de segurança (auth failures, tenant conflicts, rate limits)
- Exporter Prometheus + endpoints JSON com RBAC

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        GATEWAY FASTIFY                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌──────────────────┐                   │
│  │ TelemetryMiddle │───▶│ TelemetryRegistry│                   │
│  │ ware (hooks)    │    │ (in-memory)      │                   │
│  └─────────────────┘    └────────┬─────────┘                   │
│                                  │                              │
│                         ┌────────┴────────┐                    │
│                         │                 │                    │
│                    ┌────▼────┐      ┌────▼────┐                │
│                    │ Counter │      │Histogram│                │
│                    │ Gauge   │      │         │                │
│                    └─────────┘      └─────────┘                │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐      │
│  │                    ENDPOINTS                          │      │
│  │  GET /internal/metrics         (Prometheus, global)  │      │
│  │  GET /internal/metrics/json    (JSON, global)        │      │
│  │  GET /internal/tenants/:id/metrics (por tenant)      │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## Métricas Coletadas

### HTTP

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `libervia_http_requests_total` | counter | method, route, status_code, tenant_id | Total de requisições |
| `libervia_http_request_duration_ms` | histogram | method, route, tenant_id | Latência em ms |
| `libervia_http_errors_total` | counter | error_code, tenant_id | Total de erros 4xx/5xx |

### Segurança

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `libervia_auth_failures_total` | counter | reason, tenant_id | Falhas de autenticação |
| `libervia_tenant_conflicts_total` | counter | tenant_id | Conflitos de tenant |
| `libervia_rate_limited_total` | counter | tenant_id | Requisições bloqueadas por rate limit |

### Runtime

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `libervia_active_instances` | gauge | tenant_id | Instâncias ativas por tenant |
| `libervia_tenants_total` | gauge | status | Total de tenants por status |
| `libervia_process_uptime_seconds` | gauge | - | Uptime do processo |
| `libervia_process_memory_bytes` | gauge | type | Uso de memória |

## Endpoints

### GET /internal/metrics

Retorna métricas em formato Prometheus text.

**RBAC**: `global_admin` only

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/internal/metrics
```

**Exemplo de output:**

```
# HELP libervia_http_requests_total Total number of HTTP requests
# TYPE libervia_http_requests_total counter
libervia_http_requests_total{method="GET",route="/health",status_code="200"} 42
libervia_http_requests_total{method="GET",route="/admin/tenants",status_code="200",tenant_id=""} 5

# HELP libervia_http_request_duration_ms HTTP request duration in milliseconds
# TYPE libervia_http_request_duration_ms histogram
libervia_http_request_duration_ms_bucket{method="GET",route="/health",le="5"} 35
libervia_http_request_duration_ms_bucket{method="GET",route="/health",le="10"} 40
libervia_http_request_duration_ms_bucket{method="GET",route="/health",le="+Inf"} 42
libervia_http_request_duration_ms_sum{method="GET",route="/health"} 156.5
libervia_http_request_duration_ms_count{method="GET",route="/health"} 42

# HELP libervia_process_uptime_seconds Process uptime in seconds
# TYPE libervia_process_uptime_seconds gauge
libervia_process_uptime_seconds 3600.5

# HELP libervia_process_memory_bytes Process memory usage in bytes
# TYPE libervia_process_memory_bytes gauge
libervia_process_memory_bytes{type="heap_used"} 45678912
libervia_process_memory_bytes{type="rss"} 78901234
```

### GET /internal/metrics/json

Retorna métricas em formato JSON (para debug/UI).

**RBAC**: `global_admin` only

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/internal/metrics/json
```

### GET /internal/tenants/:tenantId/metrics

Retorna métricas filtradas por tenant.

**RBAC**: `tenant_admin` do próprio tenant OU `global_admin`

```bash
# Como tenant_admin
curl -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "X-Tenant-Id: acme" \
  http://localhost:3000/internal/tenants/acme/metrics

# Como global_admin
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/internal/tenants/acme/metrics
```

## Troubleshooting com Métricas + Logs

### Fluxo de Correlação

1. **Cliente recebe erro** com `X-Request-Id: abc123`
2. **Buscar nos logs**:
   ```bash
   docker logs libervia-gateway | grep "abc123"
   ```
3. **Verificar métricas** de erros:
   ```bash
   curl -s http://localhost:3000/internal/metrics | grep "errors_total"
   ```
4. **Correlacionar** com tenant específico via label `tenant_id`

### Exemplo de Investigação

```bash
# 1. Ver erros por tenant
curl -s http://localhost:3000/internal/metrics | \
  grep "libervia_http_errors_total"

# Output:
# libervia_http_errors_total{error_code="4xx",tenant_id="acme"} 15
# libervia_http_errors_total{error_code="5xx",tenant_id="globex"} 2

# 2. Ver falhas de autenticação
curl -s http://localhost:3000/internal/metrics | \
  grep "libervia_auth_failures_total"

# Output:
# libervia_auth_failures_total{reason="INVALID_TOKEN",tenant_id="acme"} 8
# libervia_auth_failures_total{reason="MISSING_TOKEN"} 3
```

## Sugestões de Alertas

### 1. Aumento de Erros 5xx

```yaml
# Prometheus alerting rule (conceitual)
- alert: High5xxErrorRate
  expr: rate(libervia_http_errors_total{error_code="5xx"}[5m]) > 0.1
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "Alta taxa de erros 5xx"
    description: "Mais de 0.1 erros 5xx por segundo nos últimos 5 minutos"
```

**Ação**: Verificar logs para erros internos, revisar deploys recentes.

### 2. Falhas de Autenticação Anormais

```yaml
- alert: HighAuthFailureRate
  expr: rate(libervia_auth_failures_total[5m]) > 1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Alta taxa de falhas de autenticação"
```

**Ação**: Possível ataque de força bruta ou tokens expirados em massa.

### 3. Conflitos de Tenant

```yaml
- alert: TenantConflictsDetected
  expr: increase(libervia_tenant_conflicts_total[1h]) > 0
  labels:
    severity: warning
  annotations:
    summary: "Conflitos de tenant detectados"
```

**Ação**: Verificar configuração de tokens ou integrações mal configuradas.

### 4. Latência P95 Alta

```yaml
- alert: HighP95Latency
  expr: histogram_quantile(0.95, rate(libervia_http_request_duration_ms_bucket[5m])) > 1000
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Latência P95 acima de 1 segundo"
```

**Ação**: Verificar carga, recursos, ou queries lentas.

### 5. Rate Limit Hits por Tenant

```yaml
- alert: TenantRateLimited
  expr: increase(libervia_rate_limited_total[5m]) > 10
  labels:
    severity: info
  annotations:
    summary: "Tenant atingindo rate limit frequentemente"
```

**Ação**: Revisar limites ou otimizar uso da API pelo cliente.

### 6. Uso de Memória Alto

```yaml
- alert: HighMemoryUsage
  expr: libervia_process_memory_bytes{type="heap_used"} > 500000000
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Uso de memória heap acima de 500MB"
```

**Ação**: Verificar memory leaks ou aumentar recursos.

### 7. Instâncias Inativas por Muito Tempo

```yaml
- alert: NoActiveInstances
  expr: sum(libervia_active_instances) == 0
  for: 30m
  labels:
    severity: info
  annotations:
    summary: "Nenhuma instância de tenant ativa"
```

**Ação**: Verificar se há tráfego ou se tenants estão suspensos.

### 8. Uptime Baixo (Reinícios Frequentes)

```yaml
- alert: FrequentRestarts
  expr: libervia_process_uptime_seconds < 300
  labels:
    severity: warning
  annotations:
    summary: "Processo reiniciou recentemente"
```

**Ação**: Verificar logs de crash, OOM kills, ou problemas de inicialização.

## Integração com Prometheus

### Exemplo de scrape_config

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'libervia'
    scrape_interval: 15s
    static_configs:
      - targets: ['libervia-gateway:3000']
    metrics_path: '/internal/metrics'
    bearer_token: 'seu-admin-token'

    # Ou usando file-based discovery
    # file_sd_configs:
    #   - files:
    #     - '/etc/prometheus/libervia-targets.json'
```

### Labels Recomendados

Adicione labels de ambiente no Prometheus:

```yaml
relabel_configs:
  - source_labels: [__address__]
    target_label: instance
  - target_label: environment
    replacement: 'production'
  - target_label: service
    replacement: 'libervia-gateway'
```

## Considerações Multi-Tenant

### Isolamento de Métricas

1. **global_admin** pode ver todas as métricas
2. **tenant_admin** só pode ver métricas do próprio tenant via `/internal/tenants/:id/metrics`
3. **public** não tem acesso a nenhum endpoint de métricas

### Labels de Tenant

- Todas as métricas HTTP incluem `tenant_id` quando aplicável
- Métricas sem tenant (ex: /health) não têm o label
- Nunca exponha métricas de um tenant para outro

### Evitando Labels Explosivos

O middleware normaliza rotas para evitar cardinalidade alta:

```
/admin/tenants/acme/keys → /admin/tenants/:id/keys
/api/v1/episodios/abc123 → /api/v1/episodios/:id
```

## Estrutura de Arquivos

```
gateway/
├── telemetry/
│   ├── index.ts              # Re-exports
│   ├── TelemetryTypes.ts     # Tipos e constantes
│   ├── TelemetryRegistry.ts  # Registry in-memory
│   ├── TelemetryMiddleware.ts # Hooks Fastify
│   └── TelemetrySnapshot.ts  # Exporters Prometheus/JSON
└── routes/
    └── metricsRoutes.ts      # Endpoints /internal/*
```

## Uso no Admin UI

O painel operacional inclui uma aba "Métricas" (global_admin only) que:

1. Carrega `/internal/metrics/json` por padrão
2. Toggle para formato Prometheus text
3. Renderiza em `<pre>` para fácil visualização
4. Mantém token em memória (não localStorage)

## Changelog

### v24.0.0

- TelemetryRegistry in-memory com counters, gauges e histograms
- TelemetryMiddleware com hooks onRequest/onResponse
- Endpoints Prometheus e JSON com RBAC
- Integração com Admin UI
- Documentação de alertas e troubleshooting
