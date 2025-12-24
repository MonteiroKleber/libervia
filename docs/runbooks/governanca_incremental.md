# Runbook: Governanca Incremental

**Data**: 2025-12-23
**Versao**: 1.0
**Autor**: Libervia
**Criticidade**: Alta

---

## 1. Visao Geral

Este runbook define o processo de governanca para abertura, desenvolvimento e fechamento de incrementos no Cerebro Institucional.

### 1.1 Principio Fundamental

> "Libervia nao decide porque calcula; Libervia decide porque institui."

Todo incremento DEVE preservar este principio e as garantias canonicas estabelecidas.

---

## 2. Ciclo de Vida de um Incremento

```
[Proposta] -> [Design] -> [Revisao] -> [Aprovacao] -> [Implementacao] -> [Testes] -> [Fechamento]
     |            |           |             |               |              |             |
     v            v           v             v               v              v             v
  PROPOSAL    DESIGN_DOC   REVIEW      APPROVED        IN_PROGRESS     TESTING      CLOSED
```

### 2.1 Estados

| Estado | Descricao | Documento Requerido |
|--------|-----------|---------------------|
| PROPOSAL | Ideia inicial | Template de proposta |
| DESIGN_DOC | Design detalhado | Design doc completo |
| REVIEW | Em revisao cruzada | Checklist preenchido |
| APPROVED | Aprovado para inicio | Ata de aprovacao |
| IN_PROGRESS | Em implementacao | TODO list atualizado |
| TESTING | Em validacao | Relatorio de testes |
| CLOSED | Finalizado | Changelog atualizado |

---

## 3. Processo de Abertura

### 3.1 Requisitos para Abrir Incremento

1. Proposta documentada
2. Alinhamento com roadmap
3. Garantias identificadas
4. Responsavel definido
5. Horizonte estimado

### 3.2 Template de Proposta

```markdown
# Proposta: Incremento N — [Nome]

**Data**: YYYY-MM-DD
**Proponente**: [Nome]
**Status**: PROPOSAL

## 1. Motivacao

Por que este incremento e necessario?

## 2. Objetivos

O que sera alcancado?

## 3. Entregaveis

Lista de artefatos concretos:
- [ ] Codigo
- [ ] Testes
- [ ] Documentacao
- [ ] Scripts

## 4. Garantias Preservadas

| Garantia | Como sera preservada |
|----------|---------------------|
| Imutabilidade | ... |
| Append-only | ... |
| ... | ... |

## 5. Dependencias

- Incremento X (status)
- Incremento Y (status)

## 6. Pre-condicoes

O que deve existir antes de iniciar?

## 7. Metricas de Sucesso

Como saberemos que foi bem-sucedido?

## 8. Riscos

| Risco | Mitigacao |
|-------|-----------|
| ... | ... |

## 9. Horizonte

- Inicio estimado: YYYY-MM
- Duracao estimada: N semanas

## 10. Responsavel

- Lider: [Nome]
- Revisores: [Nome1], [Nome2]
```

---

## 4. Design Doc

### 4.1 Quando Criar Design Doc

- Incrementos que afetam arquitetura
- Novos componentes
- Mudancas em interfaces
- Qualquer alteracao que possa afetar garantias

### 4.2 Template de Design Doc

```markdown
# Design: Incremento N — [Nome]

**Data**: YYYY-MM-DD
**Autor**: [Nome]
**Revisores**: [Nome1], [Nome2]
**Status**: DESIGN_DOC

## 1. Contexto

### 1.1 Problema

O que estamos resolvendo?

### 1.2 Escopo

O que esta dentro e fora do escopo?

## 2. Proposta

### 2.1 Arquitetura

Diagrama e descricao da solucao.

### 2.2 Componentes

| Componente | Responsabilidade |
|------------|------------------|
| ... | ... |

### 2.3 Interfaces

Assinaturas de metodos e tipos.

## 3. Alternativas Consideradas

### Alternativa A

- Descricao
- Pros
- Contras
- Por que nao escolhida

### Alternativa B

...

## 4. Impacto em Garantias

### 4.1 Verificacao

Para cada garantia canonica:

| Garantia | Afetada? | Como preservar |
|----------|----------|----------------|
| Imutabilidade | Sim/Nao | ... |
| Append-only | Sim/Nao | ... |
| Chain Integrity | Sim/Nao | ... |
| Single Output | Sim/Nao | ... |
| No Ranking | Sim/Nao | ... |
| Protocol Required | Sim/Nao | ... |

### 4.2 Testes de Regressao

Quais testes garantem que nao quebramos nada?

## 5. Implementacao

### 5.1 Fases

| Fase | Entregaveis | Duracao |
|------|-------------|---------|
| 1 | ... | ... |
| 2 | ... | ... |

### 5.2 Rollback Plan

Como reverter se necessario?

## 6. Observabilidade

### 6.1 Metricas

Quais metricas serao adicionadas?

### 6.2 Alertas

Quais alertas serao configurados?

## 7. Seguranca

### 7.1 Consideracoes

Implicacoes de seguranca.

### 7.2 Mitigacoes

Como serao tratadas.

## 8. Referencias

- Links para docs relacionados
- Discussoes anteriores
```

---

## 5. Revisao Cruzada

### 5.1 Quem Revisa

- Minimo 2 revisores
- Pelo menos 1 nao envolvido diretamente
- Arquiteto para mudancas estruturais

### 5.2 O Que Revisar

1. **Alinhamento com lema** - Preserva principio fundamental?
2. **Garantias** - Todas listadas e preservadas?
3. **Testes** - Cobertura adequada?
4. **Rollback** - Plano viavel?
5. **Documentacao** - Completa e clara?

### 5.3 Checklist de Revisao

```markdown
## Checklist de Revisao - Incremento N

**Revisor**: [Nome]
**Data**: YYYY-MM-DD

### Principios

- [ ] Lema institucional reafirmado explicitamente
- [ ] Nenhuma decisao automatica sendo adicionada
- [ ] Nenhum ranking ou otimizacao

### Garantias

- [ ] Imutabilidade preservada
- [ ] Append-only preservado
- [ ] Chain integrity preservada
- [ ] Single output preservado
- [ ] No ranking preservado
- [ ] Protocol required preservado

### Qualidade

- [ ] Testes de regressao definidos
- [ ] Cobertura de testes >= 80%
- [ ] Documentacao atualizada
- [ ] Changelog preparado

### Operacional

- [ ] Rollback plan documentado
- [ ] Metricas definidas
- [ ] Alertas configurados
- [ ] Runbooks atualizados

### Seguranca

- [ ] Sem vazamento de dados
- [ ] Autenticacao adequada
- [ ] Logs de auditoria

### Resultado

- [ ] APROVADO
- [ ] APROVADO COM RESSALVAS: [lista]
- [ ] REJEITADO: [motivo]

**Assinatura**: ____________
```

---

## 6. Processo de Fechamento

### 6.1 Criterios de Fechamento

1. Todos os entregaveis completos
2. Testes passando (100%)
3. Revisao de codigo aprovada
4. Documentacao atualizada
5. Changelog com entrada
6. Metricas operacionais

### 6.2 Checklist de Fechamento

```markdown
## Checklist de Fechamento - Incremento N

**Responsavel**: [Nome]
**Data**: YYYY-MM-DD

### Entregaveis

- [ ] Codigo implementado e revisado
- [ ] Testes unitarios passando
- [ ] Testes de integracao passando
- [ ] Testes de regressao passando

### Documentacao

- [ ] Design doc finalizado
- [ ] Runbooks atualizados (se aplicavel)
- [ ] Changelog atualizado
- [ ] README atualizado (se aplicavel)

### Operacional

- [ ] Metricas funcionando
- [ ] Alertas configurados
- [ ] Drill executado com sucesso
- [ ] Backup validado

### Comunicacao

- [ ] Stakeholders notificados
- [ ] Release notes preparadas
- [ ] Roadmap atualizado

### Resultado

- [ ] FECHADO em YYYY-MM-DD
- [ ] Versao: X.Y

**Assinatura**: ____________
```

---

## 7. Conformidade

### 7.1 Auditorias Periodicas

| Frequencia | Escopo | Responsavel |
|------------|--------|-------------|
| Mensal | Incrementos em andamento | Tech Lead |
| Trimestral | Roadmap e prioridades | Arquiteto |
| Anual | Garantias e principios | Security + Arquiteto |

### 7.2 Violacoes

Se uma violacao de garantia for detectada:

1. **Imediato**: Pausar implementacao
2. **Analise**: Identificar impacto
3. **Correcao**: Reverter ou corrigir
4. **Post-mortem**: Documentar aprendizado
5. **Prevencao**: Atualizar checklists

---

## 8. Templates Rapidos

### 8.1 Criar Novo Incremento

```bash
# Copiar template
cp docs/templates/proposta_incremento.md docs/incrementos/incrementoN_nome.md

# Editar proposta
# ... preencher campos ...

# Submeter para revisao
git add docs/incrementos/incrementoN_nome.md
git commit -m "Proposta: Incremento N - Nome"
```

### 8.2 Iniciar Implementacao

```bash
# Verificar aprovacao
cat docs/incrementos/incrementoN_nome.md | grep "Status: APPROVED"

# Criar branch
git checkout -b incremento-N-nome

# Atualizar status
# Status: IN_PROGRESS
```

### 8.3 Fechar Incremento

```bash
# Verificar todos os testes
npm test

# Atualizar changelog
# ... adicionar entrada ...

# Merge
git checkout main
git merge incremento-N-nome

# Tag
git tag -a vX.Y -m "Incremento N - Nome"
```

---

## 9. Metricas de Governanca

### 9.1 KPIs

| Metrica | Meta | Frequencia |
|---------|------|------------|
| Lead time (proposta -> fechamento) | < 4 semanas | Por incremento |
| Taxa de aprovacao primeira revisao | > 80% | Mensal |
| Violacoes de garantia | 0 | Continuo |
| Cobertura de testes | > 80% | Por incremento |

### 9.2 Dashboard

Acompanhar em `GET /dashboard/governance` (futuro Inc 12).

---

## 10. Excecoes

### 10.1 Hotfix de Emergencia

Para correcoes criticas:

1. Documentar justificativa
2. Minimo 1 revisor
3. Testes de regressao obrigatorios
4. Post-mortem em 48h
5. Regularizar documentacao em 1 semana

### 10.2 Bypass de Processo

NAO permitido para:

- Mudancas que afetam garantias
- Novos endpoints publicos
- Alteracoes em interfaces

---

## 11. Historico de Revisoes

| Data | Versao | Autor | Mudancas |
|------|--------|-------|----------|
| 2025-12-23 | 1.0 | Libervia | Versao inicial |

---

*Documento criado em: 2025-12-23*
