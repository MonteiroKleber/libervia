# Runbook: Auditoria Operacional

**Data**: 2025-12-23
**Versao**: 1.0
**Autor**: Libervia
**Criticidade**: Media

---

## 1. Visao Geral

Este runbook descreve os procedimentos para:
- Usar o Control-Plane para monitoramento
- Exportar eventos para auditoria
- Gerar dashboards de observabilidade
- Interpretar indicadores e diagnosticar problemas

---

## 2. Pre-requisitos

- Node.js v20+ instalado
- Acesso ao diretorio de dados (`./data`)
- Token de acesso (se configurado)
- Control-Plane rodando (para endpoints HTTP)

---

## 3. Iniciar Control-Plane

### 3.1 Comando Basico

```bash
cd incremento-1
npm run control-plane:start
```

### 3.2 Configuracao via Ambiente

```bash
# Porta do servidor (padrao: 3001)
export CONTROL_PLANE_PORT=3001

# Host (padrao: 127.0.0.1 - apenas localhost)
export CONTROL_PLANE_HOST=127.0.0.1

# Token de autenticacao (opcional em dev)
export CONTROL_PLANE_TOKEN=seu-token-secreto

# Diretorio de dados
export DATA_DIR=./data

# Iniciar
npm run control-plane:start
```

### 3.3 Saida Esperada

```
[Control-Plane] Inicializando com DATA_DIR=./data
[Control-Plane] EventLog carregado
[Control-Plane] Orquestrador inicializado
[Control-Plane] Servidor iniciado em http://127.0.0.1:3001
[Control-Plane] Token requerido: Nao (dev mode)
```

---

## 4. Endpoints Disponiveis

### 4.1 Lista de Endpoints

| Endpoint | Metodo | Descricao |
|----------|--------|-----------|
| `/` | GET | Lista de endpoints |
| `/health/eventlog` | GET | Status do EventLog |
| `/audit/export` | GET | Exportar eventos |
| `/audit/replay` | GET | Resumo operacional |
| `/dashboard/protocols` | GET | Estatisticas de protocolos |
| `/dashboard/summary` | GET | Resumo geral |

---

## 5. Verificar Status do EventLog

### 5.1 Comando

```bash
curl http://localhost:3001/health/eventlog
```

### 5.2 Resposta Normal

```json
{
  "enabled": true,
  "degraded": false,
  "errorCount": 0,
  "lastErrorAt": null,
  "lastErrorMsg": null,
  "lastErrors": []
}
```

### 5.3 Interpretacao

| Campo | Valor Normal | Alerta |
|-------|--------------|--------|
| enabled | true | false = EventLog desabilitado |
| degraded | false | true = Corrupcao detectada |
| errorCount | 0 | > 0 = Erros ocorreram |
| lastErrorMsg | null | Mensagem de erro |

### 5.4 Acoes se Degraded

1. Verificar `lastErrorMsg` para diagnostico
2. Executar backup frio (ver runbook)
3. Considerar restauracao se corrupcao severa

---

## 6. Exportar Eventos para Auditoria

### 6.1 Exportar Todos

```bash
curl http://localhost:3001/audit/export
```

### 6.2 Exportar por Periodo

```bash
# Ultimos 7 dias
curl "http://localhost:3001/audit/export?fromTs=2025-12-16T00:00:00Z&toTs=2025-12-23T23:59:59Z"
```

### 6.3 Exportar por Segmento

```bash
# Apenas segmento 1
curl "http://localhost:3001/audit/export?fromSegment=1&toSegment=1"
```

### 6.4 Salvar para Arquivo

```bash
curl http://localhost:3001/audit/export > export-$(date +%Y%m%d).json
```

### 6.5 Verificar Integridade

Na resposta, verificar:
```json
{
  "manifest": {
    "chainValidWithinExport": true
  }
}
```

Se `chainValidWithinExport: false`, a cadeia de hashes esta comprometida.

---

## 7. Gerar Resumo Operacional (Replay)

### 7.1 Resumo Completo

```bash
curl http://localhost:3001/audit/replay
```

### 7.2 Filtrar por Tipo de Evento

```bash
curl "http://localhost:3001/audit/replay?evento=DECISAO_REGISTRADA"
```

### 7.3 Filtrar por Entidade

```bash
curl "http://localhost:3001/audit/replay?entidade=SituacaoDecisoria"
```

### 7.4 Interpretacao

```json
{
  "totalEventos": 1000,
  "porEvento": {
    "SITUACAO_CRIADA": 100,
    "DECISAO_REGISTRADA": 80
  },
  "porAtor": {
    "Libervia": 800,
    "Bazari": 200
  },
  "inconsistencias": [],
  "truncated": false
}
```

| Campo | Significado |
|-------|-------------|
| totalEventos | Quantidade total de eventos |
| porEvento | Distribuicao por tipo |
| porAtor | Libervia vs Bazari |
| inconsistencias | Problemas detectados |
| truncated | true se excedeu limite |

---

## 8. Estatisticas de Protocolos

### 8.1 Comando

```bash
curl http://localhost:3001/dashboard/protocols
```

### 8.2 Resposta

```json
{
  "total": 100,
  "porEstado": {
    "VALIDADO": 85,
    "REJEITADO": 15
  },
  "porPerfilRisco": {
    "CONSERVADOR": 30,
    "MODERADO": 50,
    "AGRESSIVO": 20
  }
}
```

### 8.3 Metricas de Qualidade

| Metrica | Formula | Meta |
|---------|---------|------|
| Taxa de validacao | VALIDADO / total | > 80% |
| Perfil conservador | CONSERVADOR / total | Depende do dominio |

---

## 9. Resumo Geral do Sistema

### 9.1 Comando

```bash
curl http://localhost:3001/dashboard/summary
```

### 9.2 Resposta

```json
{
  "timestamp": "2025-12-23T14:00:00.000Z",
  "eventLog": {
    "enabled": true,
    "degraded": false,
    "totalEventos": 1000
  },
  "protocolos": {
    "total": 100,
    "validados": 85,
    "rejeitados": 15
  },
  "eventosDistribuicao": {...},
  "atoresDistribuicao": {...}
}
```

---

## 10. Gerar Dashboards Estaticos

### 10.1 Comando

```bash
cd incremento-1
npm run dashboards:generate
```

### 10.2 Com Diretorios Customizados

```bash
npm run dashboards:generate -- ./data ./dashboards
```

### 10.3 Arquivos Gerados

```
dashboards/
├── dashboard-20251223-140000.md    # Markdown
└── dashboard-20251223-140000.json  # Dados brutos
```

### 10.4 Visualizar Dashboard

```bash
cat dashboards/dashboard-*.md | less
```

Ou abrir em editor Markdown.

---

## 11. Diagnostico de Problemas

### 11.1 EventLog Degraded

**Sintoma**: `degraded: true` no health check

**Diagnostico**:
```bash
# Verificar ultimo erro
curl http://localhost:3001/health/eventlog | jq '.lastErrorMsg'

# Verificar cadeia completa
curl http://localhost:3001/audit/replay | jq '.inconsistencias'
```

**Acoes**:
1. Identificar ponto de corrupcao
2. Restaurar do backup mais recente
3. Verificar integridade apos restauracao

### 11.2 Muitos Protocolos Rejeitados

**Sintoma**: Taxa de REJEITADO > 20%

**Diagnostico**:
```bash
curl http://localhost:3001/dashboard/protocols | jq '.porEstado'
```

**Acoes**:
1. Revisar criterios de validacao
2. Analisar padroes de rejeicao
3. Verificar se dados de entrada estao corretos

### 11.3 Eventos Nao Aparecendo

**Sintoma**: `totalEventos` nao aumenta

**Diagnostico**:
```bash
# Verificar se EventLog esta enabled
curl http://localhost:3001/health/eventlog | jq '.enabled'

# Verificar erros recentes
curl http://localhost:3001/health/eventlog | jq '.lastErrors'
```

**Acoes**:
1. Verificar se Orquestrador foi inicializado com EventLog
2. Verificar permissoes de escrita no diretorio
3. Verificar espaco em disco

---

## 12. Autenticacao

### 12.1 Configurar Token

```bash
export CONTROL_PLANE_TOKEN="meu-token-secreto"
npm run control-plane:start
```

### 12.2 Usar Token em Requisicoes

```bash
curl -H "Authorization: Bearer meu-token-secreto" http://localhost:3001/health/eventlog
```

### 12.3 Modo Desenvolvimento

Se `CONTROL_PLANE_TOKEN` nao estiver definido e `NODE_ENV != production`:
- Acesso permitido sem token

---

## 13. Agendamento de Dashboards

### 13.1 Cron para Geracao Diaria

```bash
# /etc/cron.d/libervia-dashboard
0 6 * * * libervia cd /app/incremento-1 && npm run dashboards:generate -- ./data /dashboards/daily
```

### 13.2 Rotacao de Dashboards

```bash
# Manter ultimos 30 dias
find /dashboards -name "dashboard-*.md" -mtime +30 -delete
find /dashboards -name "dashboard-*.json" -mtime +30 -delete
```

---

## 14. Contatos de Emergencia

| Papel | Contato |
|-------|---------|
| DBA | (preencher) |
| DevOps | (preencher) |
| Arquiteto | (preencher) |

---

## 15. Historico de Revisoes

| Data | Versao | Autor | Mudancas |
|------|--------|-------|----------|
| 2025-12-23 | 1.0 | Libervia | Versao inicial |

---

*Documento gerado em: 2025-12-23*
