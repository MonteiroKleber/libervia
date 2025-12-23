# Incremento 6 - Observabilidade e Auditoria Interna

**Data**: 2025-12-23
**Autor**: Libervia
**Status**: Em Implementacao

---

## 1. Escopo

O Incremento 6 habilita **visibilidade operacional interna** do sistema Libervia atraves de:

1. **Control-plane leve**: Servidor HTTP interno com endpoints de auditoria
2. **Dashboards estaticos**: Scripts para geracao de paineis de status
3. **Metricas minimas**: Indicadores de saude e operacao do sistema

### 1.1 O que NAO esta no escopo

- Interface publica (frontend, APIs externas)
- Dashboards interativos (Grafana, etc.)
- Metricas de performance (latencia, throughput)
- Alertas automaticos

---

## 2. Requisitos

### 2.1 Reuso de APIs Existentes

O control-plane deve reutilizar as APIs ja implementadas:

| API | Incremento | Uso |
|-----|------------|-----|
| `GetEventLogStatus()` | 4.1 | Status de saude |
| `ExportEventLogForAudit()` | 4.3 | Export de eventos |
| `ReplayEventLog()` | 4.3 | Resumo operacional |
| `VerifyEventLogNow()` | 4.1 | Verificacao sob demanda |

### 2.2 Seguranca

- Acessivel apenas por canal administrativo (localhost por padrao)
- Autenticacao minima via token estatico (env `CONTROL_PLANE_TOKEN`)
- Nenhum impacto na logica de decisao do Orquestrador
- Falhas no control-plane NAO afetam operacoes normais

### 2.3 Metricas Minimas

| Metrica | Fonte | Descricao |
|---------|-------|-----------|
| EventLog status | `GetEventLogStatus()` | enabled, degraded, errorCount |
| Protocolos por estado | `DecisionProtocolRepository` | VALIDADO vs REJEITADO |
| Eventos por tipo | `ReplayEventLog()` | Distribuicao de tipos |
| Eventos por ator | `ReplayEventLog()` | Libervia vs Bazari |
| Ultimo hash | `ExportEventLogForAudit()` | Ancoragem atual |

---

## 3. Arquitetura

### 3.1 Estrutura de Arquivos

```
incremento-1/
├── control-plane/
│   ├── Server.ts           # Servidor HTTP principal
│   ├── routes/
│   │   ├── audit.ts        # /audit/export, /audit/replay
│   │   ├── health.ts       # /health/eventlog
│   │   └── dashboard.ts    # /dashboard/protocols
│   └── middleware/
│       └── auth.ts         # Autenticacao por token
├── scripts/
│   └── gerar_dashboard_eventlog.ts
└── dashboards/
    └── (arquivos gerados)
```

### 3.2 Endpoints

| Endpoint | Metodo | Descricao |
|----------|--------|-----------|
| `GET /health/eventlog` | GET | Status do EventLog |
| `GET /audit/export` | GET | Exporta eventos (params: fromTs, toTs, fromSegment, toSegment) |
| `GET /audit/replay` | GET | Resumo operacional (params: evento, entidade, fromTs, toTs) |
| `GET /dashboard/protocols` | GET | Estatisticas de protocolos |
| `GET /dashboard/summary` | GET | Resumo geral do sistema |

### 3.3 Fluxo

```
┌─────────────────┐      ┌──────────────────┐      ┌────────────────┐
│  Operador/CLI   │ ──── │  Control-Plane   │ ──── │  Orquestrador  │
└─────────────────┘      └──────────────────┘      └────────────────┘
                                  │
                                  ├──── DecisionProtocolRepository
                                  └──── EventLogRepository
```

---

## 4. Especificacao de Endpoints

### 4.1 GET /health/eventlog

Retorna status atual do EventLog.

**Request**: Nenhum parametro

**Response**:
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

### 4.2 GET /audit/export

Exporta eventos para auditoria.

**Query Parameters**:
| Param | Tipo | Descricao |
|-------|------|-----------|
| fromTs | ISO date | Data inicio (opcional) |
| toTs | ISO date | Data fim (opcional) |
| fromSegment | number | Segmento inicio (opcional) |
| toSegment | number | Segmento fim (opcional) |

**Response**:
```json
{
  "manifest": {
    "fromTs": "2025-12-01T00:00:00.000Z",
    "toTs": "2025-12-23T23:59:59.000Z",
    "count": 1000,
    "firstId": "evt-xxx",
    "lastId": "evt-yyy",
    "chainValidWithinExport": true
  },
  "entries": [...]
}
```

### 4.3 GET /audit/replay

Gera resumo operacional.

**Query Parameters**:
| Param | Tipo | Descricao |
|-------|------|-----------|
| evento | string | Filtrar por tipo de evento |
| entidade | string | Filtrar por tipo de entidade |
| fromTs | ISO date | Data inicio (opcional) |
| toTs | ISO date | Data fim (opcional) |

**Response**:
```json
{
  "totalEventos": 1000,
  "porEvento": {
    "SITUACAO_CRIADA": 100,
    "EPISODIO_CRIADO": 100,
    "DECISAO_REGISTRADA": 80
  },
  "porEntidade": {
    "SituacaoDecisoria": 200,
    "EpisodioDecisao": 100
  },
  "porAtor": {
    "Libervia": 800,
    "Bazari": 200
  },
  "range": {
    "firstTs": "2025-12-01T00:00:00.000Z",
    "lastTs": "2025-12-23T23:59:59.000Z"
  },
  "inconsistencias": [],
  "truncated": false
}
```

### 4.4 GET /dashboard/protocols

Estatisticas de protocolos de decisao.

**Response**:
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
  },
  "ultimoProtocolo": {
    "id": "prot-xxx",
    "estado": "VALIDADO",
    "validado_em": "2025-12-23T10:00:00.000Z"
  }
}
```

### 4.5 GET /dashboard/summary

Resumo geral do sistema.

**Response**:
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
  "ultimoEvento": {
    "id": "evt-xxx",
    "tipo": "CONTRATO_EMITIDO",
    "timestamp": "2025-12-23T13:59:00.000Z"
  }
}
```

---

## 5. Autenticacao

### 5.1 Token Estatico

```bash
# Configurar token via ambiente
export CONTROL_PLANE_TOKEN="meu-token-secreto"

# Usar em requisicoes
curl -H "Authorization: Bearer meu-token-secreto" http://localhost:3001/health/eventlog
```

### 5.2 Modo Desenvolvimento

Se `CONTROL_PLANE_TOKEN` nao estiver definido:
- Em desenvolvimento (`NODE_ENV != production`): permite acesso sem token
- Em producao: requer token obrigatoriamente

---

## 6. Dashboards Estaticos

### 6.1 Script de Geracao

```bash
npm run dashboards:generate
```

Gera arquivos em `incremento-1/dashboards/`:
- `dashboard-YYYYMMDD-HHMMSS.md` - Markdown
- `dashboard-YYYYMMDD-HHMMSS.json` - Dados brutos

### 6.2 Conteudo do Dashboard

```markdown
# Dashboard Libervia - 2025-12-23 14:00:00

## Status do EventLog
- Enabled: true
- Degraded: false
- Ultimo erro: N/A

## Protocolos de Decisao
| Estado | Quantidade |
|--------|------------|
| VALIDADO | 85 |
| REJEITADO | 15 |

## Eventos por Tipo
| Tipo | Quantidade |
|------|------------|
| SITUACAO_CRIADA | 100 |
| EPISODIO_CRIADO | 100 |
| DECISAO_REGISTRADA | 80 |

## Eventos por Ator
| Ator | Quantidade |
|------|------------|
| Libervia | 800 |
| Bazari | 200 |
```

---

## 7. Decisoes de Design

### 7.1 Por que HTTP puro?

- Sem dependencias externas (Express, Fastify)
- Menor superficie de ataque
- Mais facil de auditar
- Suficiente para endpoints simples

### 7.2 Por que token estatico?

- Simplicidade para fase inicial
- Pode evoluir para JWT/OAuth em incremento futuro
- Adequado para acesso interno/operacional

### 7.3 Por que dashboards em Markdown?

- Legivel sem ferramentas especiais
- Versionavel em git
- Pode ser convertido para HTML facilmente

---

## 8. Testes

| # | Cenario | Descricao |
|---|---------|-----------|
| 1 | Health endpoint | Retorna status correto |
| 2 | Export com parametros | Filtra por data/segmento |
| 3 | Replay com filtros | Filtra por evento/entidade |
| 4 | Protocolos agregados | Conta VALIDADO/REJEITADO |
| 5 | Autenticacao | Bloqueia sem token valido |
| 6 | Dashboard script | Gera arquivos corretamente |

---

## 9. Configuracao

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `CONTROL_PLANE_PORT` | 3001 | Porta do servidor |
| `CONTROL_PLANE_HOST` | 127.0.0.1 | Host (localhost por seguranca) |
| `CONTROL_PLANE_TOKEN` | (none) | Token de autenticacao |
| `NODE_ENV` | development | Ambiente |

---

## 10. Limitacoes

| Limitacao | Motivo | Mitigacao Futura |
|-----------|--------|------------------|
| Token estatico | Simplicidade | JWT/OAuth |
| Apenas localhost | Seguranca | Reverse proxy |
| Sem TLS | Escopo interno | HTTPS em producao |
| Sem rate limiting | Escopo interno | Middleware de rate limit |

---

## 11. Checklist de Implementacao

- [ ] Criar `control-plane/Server.ts`
- [ ] Implementar endpoints de health
- [ ] Implementar endpoints de audit
- [ ] Implementar endpoints de dashboard
- [ ] Adicionar autenticacao por token
- [ ] Criar script `gerar_dashboard_eventlog.ts`
- [ ] Adicionar scripts ao `package.json`
- [ ] Criar testes `incremento6.test.ts`
- [ ] Criar runbook de auditoria
- [ ] Atualizar documentacao canonica

---

*Documento criado em: 2025-12-23*
*Versao: 6.0*
