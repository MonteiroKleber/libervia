# Operacao Continua - Cerebro Institucional

**Data de Inicio**: 2025-12-23
**Versao**: 1.0
**Responsavel**: Libervia
**Cadencia**: Quinzenal

---

## 1. Agenda de Operacoes

### 1.1 Cadencia Definida

| Operacao | Frequencia | Dia/Hora | Responsavel | Comando |
|----------|------------|----------|-------------|---------|
| Drill Go-Live | Quinzenal | Seg 08:00 | Ops | `npm run drill:go-live 50` |
| Backup Frio | Semanal | Dom 02:00 | Ops | `npm run backup-frio` |
| Dashboard | Diario | 06:00 | Auto | `npm run dashboards:generate` |
| Metricas | Continuo | - | Auto | `npm run operacao:metrics` |

### 1.2 Calendario

| Semana | Data | Drill | Backup | Dashboard | Status |
|--------|------|-------|--------|-----------|--------|
| S1 | 2025-12-23 | X | X | X | Pendente |
| S2 | 2025-12-30 | - | X | X | Pendente |
| S3 | 2026-01-06 | X | X | X | Pendente |
| S4 | 2026-01-13 | - | X | X | Pendente |

---

## 2. Metricas-Chave

### 2.1 Thresholds

| Metrica | Threshold Warning | Threshold Critical | Unidade |
|---------|-------------------|-------------------|---------|
| Tempo do Drill | > 120s | > 300s | segundos |
| Erros verifyChain | > 0 | > 0 | count |
| Segmentos Ativos | > 100 | > 500 | count |
| Eventos no EventLog | > 100.000 | > 500.000 | count |
| Taxa de Sucesso Drill | < 100% | < 90% | percentual |
| Tempo Medio Requisicao | > 500ms | > 2000ms | ms |

### 2.2 Historico de Metricas

| Data | Drill(s) | Erros | Segmentos | Eventos | Taxa | Status |
|------|----------|-------|-----------|---------|------|--------|
| | | | | | | |

---

## 3. Registro de Execucoes

### 3.1 Template de Registro

```markdown
### Execucao [DATA]

**Operador**: [NOME]
**Tipo**: [Drill | Backup | Dashboard | Metricas]
**Inicio**: [HH:MM]
**Fim**: [HH:MM]
**Status**: [OK | WARNING | CRITICAL]

**Metricas**:
- Tempo total: X segundos
- Erros: N
- Observacoes: [texto]

**Acoes Tomadas**:
- [acao 1]
- [acao 2]
```

### 3.2 Execucoes Recentes

<!-- Adicionar registros aqui -->

---

## 4. Alertas

### 4.1 Configuracao de Alertas

| Nivel | Acao | Destinatario |
|-------|------|--------------|
| WARNING | Log + stdout | Operador |
| CRITICAL | Log + Email | Equipe |

### 4.2 Historico de Alertas

| Data | Nivel | Metrica | Valor | Threshold | Acao |
|------|-------|---------|-------|-----------|------|
| | | | | | |

---

## 5. Contatos

| Papel | Nome | Email | Telefone |
|-------|------|-------|----------|
| Operador Principal | (preencher) | | |
| Backup Operador | (preencher) | | |
| Escalacao | (preencher) | | |

---

## 6. Procedimentos de Escalacao

### 6.1 Fluxo de Escalacao

1. **WARNING**: Operador analisa e documenta
2. **CRITICAL**: Operador notifica equipe imediatamente
3. **Sem resolucao em 1h**: Escalar para lideranca

### 6.2 Acoes por Tipo de Alerta

| Alerta | Acao Imediata | Acao de Recuperacao |
|--------|---------------|---------------------|
| Erro verifyChain | Parar operacoes | Restaurar backup |
| Drill falhou | Analisar logs | Corrigir e re-executar |
| Segmentos > threshold | Executar prune | Aumentar retencao |

---

## 7. Proxima Revisao

- **Data**: (2 semanas apos inicio)
- **Responsavel**: (preencher)
- **Itens a revisar**:
  - [ ] Thresholds adequados?
  - [ ] Cadencia suficiente?
  - [ ] Alertas funcionando?
  - [ ] Documentacao atualizada?

---

*Documento criado em: 2025-12-23*
*Ultima atualizacao: 2025-12-23*
