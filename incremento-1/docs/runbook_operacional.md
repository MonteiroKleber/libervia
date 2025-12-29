# Runbook Operacional — Libervia Gateway

## Visao Geral

Este documento descreve os procedimentos operacionais para manter o sistema Libervia em producao. Destinado a equipes de operacao (SRE, DevOps, suporte N2/N3).

### Arquitetura em Producao

```
                    ┌─────────────────┐
                    │   Load Balancer │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐ ┌─────▼─────┐ ┌─────▼─────┐
       │  Gateway 1  │ │ Gateway 2 │ │ Gateway N │
       │  (Fastify)  │ │ (Fastify) │ │ (Fastify) │
       └──────┬──────┘ └─────┬─────┘ └─────┬─────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │   File System   │
                    │  (EventLog/Data)│
                    └─────────────────┘
```

### Componentes

| Componente | Funcao | Porta |
|------------|--------|-------|
| Gateway Fastify | API REST multi-tenant | 3000 |
| TenantRegistry | Gerenciamento de tenants | - |
| TenantRuntime | Instancias Core por tenant | - |
| EventLog | Persistencia de eventos | - |
| TelemetryRegistry | Metricas in-memory | - |

---

## Dependencias Criticas

### Externas

| Dependencia | Criticidade | Fallback |
|-------------|-------------|----------|
| File System | CRITICA | Nenhum - sistema para |
| DNS | ALTA | Cache local |
| NTP | MEDIA | Logs com timestamp incorreto |

### Internas

| Dependencia | Criticidade | Impacto se falhar |
|-------------|-------------|-------------------|
| LIBERVIA_AUTH_PEPPER | CRITICA | Gateway nao inicia |
| ADMIN_TOKEN | CRITICA | Sem acesso admin |
| BASE_DIR | CRITICA | Sem persistencia |

---

## Variaveis de Ambiente Criticas

```bash
# OBRIGATORIAS
LIBERVIA_AUTH_PEPPER=<string-32-chars-min>  # Pepper para hash de tokens
ADMIN_TOKEN=<token-admin>                    # Token global admin
BASE_DIR=/data/libervia                      # Diretorio de dados

# OPCIONAIS
PORT=3000                                    # Porta do servidor
HOST=0.0.0.0                                 # Host de bind
NODE_ENV=production                          # Ambiente
LOG_LEVEL=info                               # Nivel de log
CORS_ORIGINS=https://app.example.com         # Origens CORS permitidas
```

### Validacao de Ambiente

```bash
# Verificar variaveis obrigatorias
./scripts/print_env_template.sh

# Testar conexao
curl -s http://localhost:3000/health | jq .
```

---

## Checklist de Startup

### Pre-Startup

- [ ] Verificar espaco em disco (minimo 1GB livre)
- [ ] Verificar variaveis de ambiente configuradas
- [ ] Verificar permissoes no BASE_DIR
- [ ] Verificar conectividade de rede
- [ ] Verificar versao do Node.js (>=18)

### Startup

```bash
# 1. Verificar ambiente
node --version  # >= 18.x
npm --version

# 2. Iniciar aplicacao
npm run start:prod

# Ou via Docker
docker-compose up -d
```

### Pos-Startup

- [ ] Verificar health check: `GET /health`
- [ ] Verificar readiness: `GET /health/ready`
- [ ] Verificar metricas: `GET /internal/metrics` (com token admin)
- [ ] Verificar logs de inicializacao (sem erros)
- [ ] Testar autenticacao admin

```bash
# Verificacao rapida
curl -s http://localhost:3000/health | jq .status
# Esperado: "ok"

curl -s http://localhost:3000/health/ready | jq .status
# Esperado: "ok"
```

---

## Checklist de Shutdown Seguro

### Pre-Shutdown

- [ ] Notificar stakeholders
- [ ] Verificar jobs em andamento
- [ ] Drenar conexoes ativas (se load balancer)

### Shutdown

```bash
# Graceful shutdown via signal
kill -SIGTERM <PID>

# Ou via Docker
docker-compose stop

# Aguardar ate 30 segundos para finalizacao
```

### Pos-Shutdown

- [ ] Verificar que processo terminou
- [ ] Verificar integridade do EventLog
- [ ] Coletar logs finais

```bash
# Verificar integridade apos shutdown
node -e "
const { TenantRegistry } = require('./tenant/TenantRegistry');
// Verificar registros
"
```

---

## Checklist de Upgrade

### Pre-Upgrade

- [ ] Backup do BASE_DIR
- [ ] Documentar versao atual
- [ ] Ler changelog da nova versao
- [ ] Testar em ambiente de staging

```bash
# Backup
./scripts/run_backup_frio.sh

# Versao atual
cat package.json | jq .version
```

### Durante Upgrade

```bash
# 1. Parar servico
docker-compose stop

# 2. Pull nova imagem
docker-compose pull

# 3. Iniciar nova versao
docker-compose up -d

# 4. Verificar logs
docker-compose logs -f --tail=100
```

### Pos-Upgrade

- [ ] Verificar health check
- [ ] Verificar metricas
- [ ] Testar rotas criticas
- [ ] Monitorar por 15 minutos
- [ ] Validar com stakeholders

### Rollback (se necessario)

```bash
# 1. Parar versao nova
docker-compose stop

# 2. Restaurar imagem anterior
docker-compose pull <versao-anterior>

# 3. Restaurar backup se necessario
./scripts/restore_backup.sh <backup-file>

# 4. Iniciar versao anterior
docker-compose up -d
```

---

## Procedimentos de Resposta a Incidentes

### PROC-001: API Fora do Ar

**Sintomas:**
- Health check retorna erro ou timeout
- Usuarios reportam erro de conexao
- Alerta API_DOWN disparado

**Diagnostico:**

```bash
# 1. Verificar processo
ps aux | grep node
docker ps

# 2. Verificar porta
netstat -tlnp | grep 3000
lsof -i :3000

# 3. Verificar logs
docker logs libervia-gateway --tail=200

# 4. Verificar recursos
df -h
free -m
```

**Acoes:**

1. Se processo morto:
   ```bash
   docker-compose restart gateway
   ```

2. Se porta ocupada:
   ```bash
   kill -9 <PID-ocupando-porta>
   docker-compose restart gateway
   ```

3. Se disco cheio:
   ```bash
   # Limpar logs antigos
   find /var/log -name "*.log" -mtime +7 -delete
   # Limpar test artifacts
   rm -rf test-artifacts/*
   ```

4. Se memoria esgotada:
   ```bash
   # Reiniciar com mais memoria
   docker-compose down
   # Ajustar NODE_OPTIONS no docker-compose.yml
   docker-compose up -d
   ```

**Escalacao:** Se nao resolver em 15 minutos, escalar para equipe de desenvolvimento.

---

### PROC-002: Latencia Elevada

**Sintomas:**
- p95 acima de 1000ms
- Usuarios reportam lentidao
- Alerta HIGH_LATENCY disparado

**Diagnostico:**

```bash
# 1. Verificar metricas de latencia
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/internal/metrics | \
  grep "http_request_duration_ms"

# 2. Verificar carga
top -b -n 1 | head -20

# 3. Verificar I/O
iostat -x 1 5

# 4. Verificar conexoes
ss -s
```

**Acoes:**

1. Se CPU alta:
   - Verificar tenants com muito trafego
   - Considerar rate limiting mais agressivo
   - Escalar horizontalmente

2. Se I/O alto:
   - Verificar disco (IOPS)
   - Considerar SSD se usando HDD
   - Verificar EventLog muito grande

3. Se muitas conexoes:
   - Verificar connection pooling
   - Verificar clientes mal comportados

**Escalacao:** Se p95 > 5000ms por mais de 5 minutos.

---

### PROC-003: Erro 5xx em Massa

**Sintomas:**
- Taxa de erro 5xx > 1%
- Alerta ERROR_RATE_SPIKE disparado
- Usuarios reportam erros

**Diagnostico:**

```bash
# 1. Verificar metricas de erro
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/internal/metrics | \
  grep "http_errors_total"

# 2. Verificar logs de erro
docker logs libervia-gateway 2>&1 | grep -i error | tail -50

# 3. Identificar padrao
docker logs libervia-gateway 2>&1 | grep "statusCode\":5" | \
  jq -r '.msg' | sort | uniq -c | sort -rn
```

**Acoes:**

1. Se erro especifico identificado:
   - Consultar documentacao do erro
   - Aplicar fix conhecido

2. Se erro em tenant especifico:
   - Suspender tenant temporariamente
   - Investigar dados do tenant

3. Se erro generalizado:
   - Considerar rollback
   - Coletar evidencias

**Escalacao:** Se taxa > 5% por mais de 2 minutos.

---

### PROC-004: Falhas de Autenticacao

**Sintomas:**
- Aumento de auth_failures_total
- Alerta AUTH_FAILURE_SPIKE disparado
- Usuarios legitimos reportam "token invalido"

**Diagnostico:**

```bash
# 1. Verificar metricas
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/internal/metrics | \
  grep "auth_failures_total"

# 2. Verificar por reason
# INVALID_TOKEN = tokens incorretos
# MISSING_TOKEN = requisicoes sem token

# 3. Verificar por tenant
# Se concentrado em um tenant, pode ser ataque
```

**Acoes:**

1. Se INVALID_TOKEN em massa de mesmo IP:
   - Possivel ataque de forca bruta
   - Considerar bloqueio de IP
   - Verificar rate limiting

2. Se tokens de tenant especifico:
   - Verificar se keys foram revogadas
   - Regenerar keys se necessario

3. Se generalizado:
   - Verificar LIBERVIA_AUTH_PEPPER
   - Verificar sincronizacao de relogio (NTP)

**Escalacao:** Se suspeita de ataque.

---

### PROC-005: Conflitos de Tenant

**Sintomas:**
- tenant_conflicts_total aumentando
- Alerta TENANT_CONFLICT_SPIKE disparado

**Diagnostico:**

```bash
# 1. Verificar metricas
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/internal/metrics | \
  grep "tenant_conflicts_total"

# 2. Verificar logs
docker logs libervia-gateway 2>&1 | grep "TENANT_CONFLICT"
```

**Acoes:**

1. Identificar cliente causador
2. Verificar integracao do cliente (SDK desatualizado?)
3. Contatar cliente para correcao

**Escalacao:** Se impacto em multiplos tenants.

---

### PROC-006: Rate Limit Excessivo

**Sintomas:**
- rate_limited_total alto para tenant especifico
- Alerta RATE_LIMIT_ABUSE disparado
- Cliente reclama de bloqueios

**Diagnostico:**

```bash
# 1. Verificar metricas por tenant
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/internal/metrics | \
  grep "rate_limited_total"

# 2. Verificar configuracao do tenant
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/<tenant-id>
```

**Acoes:**

1. Se uso legitimo:
   - Avaliar aumento de quota
   - Discutir com cliente otimizacoes

2. Se abuso:
   - Manter limites
   - Notificar cliente
   - Considerar suspensao se persistir

---

### PROC-007: Corrupcao no EventLog

**Sintomas:**
- Erros de parse JSON em logs
- Verificacao de integridade falha
- Dados inconsistentes

**Diagnostico:**

```bash
# 1. Verificar integridade
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/<tenant-id>/audit/verify

# 2. Verificar arquivos
ls -la $BASE_DIR/tenants/<tenant-id>/eventlog/

# 3. Tentar parse manual
cat $BASE_DIR/tenants/<tenant-id>/eventlog/events.jsonl | \
  head -10 | jq .
```

**Acoes:**

1. CRITICO: Nao modificar arquivos originais
2. Fazer backup imediato:
   ```bash
   cp -r $BASE_DIR/tenants/<tenant-id> /backup/corrupted-$(date +%s)/
   ```
3. Identificar ultimo evento valido
4. Considerar restauracao de backup

**Escalacao:** Imediata para equipe de desenvolvimento.

---

### PROC-008: Mandatos Suspensos em Cascata

**Sintomas:**
- Multiplos mandatos suspensos simultaneamente
- Tenants reportam operacoes bloqueadas

**Diagnostico:**

```bash
# 1. Verificar mandatos suspensos
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/query/tenants | \
  jq '.[] | select(.status == "suspended")'

# 2. Verificar causa nos logs
docker logs libervia-gateway 2>&1 | grep "suspended"
```

**Acoes:**

1. Identificar causa raiz (consequencia critica? violacao de policy?)
2. Avaliar se suspensao foi correta
3. Se erro, reativar mandatos manualmente:
   ```bash
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
     http://localhost:3000/admin/tenants/<tenant-id>/resume
   ```

**Escalacao:** Se causa desconhecida.

---

## Procedimento de Rollback

### Quando Fazer Rollback

- Erros 5xx > 10% por mais de 5 minutos
- Perda de dados detectada
- Funcionalidade critica quebrada
- Vulnerabilidade de seguranca descoberta

### Passos

```bash
# 1. Confirmar decisao de rollback
# Documentar: hora, motivo, quem autorizou

# 2. Parar versao atual
docker-compose stop

# 3. Restaurar versao anterior
docker tag libervia-gateway:current libervia-gateway:failed-$(date +%s)
docker tag libervia-gateway:previous libervia-gateway:current

# 4. Restaurar dados se necessario
./scripts/restore_backup.sh <backup-mais-recente>

# 5. Iniciar versao anterior
docker-compose up -d

# 6. Verificar
curl -s http://localhost:3000/health | jq .

# 7. Monitorar por 30 minutos

# 8. Documentar incidente
```

---

## Procedimento de Coleta de Evidencias

### Quando Coletar

- Qualquer incidente Sev1 ou Sev2
- Antes de qualquer acao destrutiva
- Quando solicitado por seguranca

### O Que Coletar

```bash
# Criar diretorio de evidencias
EVIDENCE_DIR=/tmp/evidence-$(date +%Y%m%d-%H%M%S)
mkdir -p $EVIDENCE_DIR

# 1. Logs do container
docker logs libervia-gateway --since 1h > $EVIDENCE_DIR/container.log 2>&1

# 2. Metricas
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/internal/metrics > $EVIDENCE_DIR/metrics.txt

curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/internal/metrics/json > $EVIDENCE_DIR/metrics.json

# 3. Estado do sistema
docker ps -a > $EVIDENCE_DIR/docker-ps.txt
docker stats --no-stream > $EVIDENCE_DIR/docker-stats.txt
df -h > $EVIDENCE_DIR/disk.txt
free -m > $EVIDENCE_DIR/memory.txt
ps aux > $EVIDENCE_DIR/processes.txt

# 4. Configuracao (sem secrets)
env | grep -v TOKEN | grep -v PEPPER > $EVIDENCE_DIR/env-filtered.txt

# 5. Health checks
curl -s http://localhost:3000/health > $EVIDENCE_DIR/health.json
curl -s http://localhost:3000/health/ready > $EVIDENCE_DIR/ready.json

# 6. Compactar
tar -czf $EVIDENCE_DIR.tar.gz $EVIDENCE_DIR

echo "Evidencias coletadas em: $EVIDENCE_DIR.tar.gz"
```

### Retencao

- Manter evidencias por minimo 90 dias
- Evidencias de incidentes de seguranca: 1 ano
- Armazenar em local seguro e imutavel

---

## Contatos de Escalacao

| Nivel | Responsavel | Contato | Quando |
|-------|-------------|---------|--------|
| N1 | Operacao | ops@example.com | Primeiro contato |
| N2 | SRE | sre@example.com | Incidentes nao resolvidos em 15min |
| N3 | Desenvolvimento | dev@example.com | Bugs, corrupcao, rollback |
| Seguranca | Security | security@example.com | Suspeita de ataque |

---

## Changelog

### v25.0.0
- Documento inicial
- Procedimentos PROC-001 a PROC-008
- Checklists de startup, shutdown, upgrade
- Procedimento de rollback
- Procedimento de coleta de evidencias
