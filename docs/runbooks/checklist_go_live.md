# Checklist Go-Live - Cerebro Institucional

**Data**: 2025-12-23
**Versao**: 1.0
**Autor**: Libervia
**Criticidade**: Alta

---

## 1. Visao Geral

Este checklist documenta todos os passos necessarios para validar o sistema antes do lancamento em producao. Cada item deve ser verificado e marcado como concluido antes de prosseguir.

---

## 2. Pre-Requisitos

### 2.1 Ambiente

- [ ] Node.js >= 18.x instalado
- [ ] npm >= 9.x instalado
- [ ] Dependencias instaladas (`npm install`)
- [ ] TypeScript compila sem erros (`npm run build`)
- [ ] Diretorios de dados configurados corretamente

### 2.2 Acesso

- [ ] Acesso ao repositorio Git
- [ ] Credenciais de backup configuradas (se aplicavel)
- [ ] Token de integracao Bazari configurado (opcional em dev)

---

## 3. Validacao de Codigo

### 3.1 Testes Automatizados

```bash
# Executar todos os testes
npm test

# Resultado esperado: Todos os testes passam (0 falhas)
```

- [ ] `npm test` executa sem falhas
- [ ] Cobertura de testes >= 60% (recomendado)

### 3.2 Testes por Incremento

```bash
# Incremento 7: Interface Controlada Bazari
npm test -- --testPathPattern=incremento7

# Incremento 8: Preparacao Go-Live
npm test -- --testPathPattern=incremento8
```

- [ ] Incremento 7: 28 testes passando
- [ ] Incremento 8: 17 testes passando

---

## 4. Validacao de Garantias

### 4.1 Sem Delete/Update

**Objetivo**: Confirmar que repositorios nao possuem metodos de delecao/atualizacao.

```bash
# Verificar ausencia de metodos proibidos
grep -r "\.delete\|\.update" incremento-1/repositorios/implementacao/*.ts
```

- [ ] Nenhum metodo `delete` encontrado
- [ ] Nenhum metodo `update` encontrado

### 4.2 Unica Saida = ContratoDeDecisao

**Objetivo**: Confirmar que BazariAdapter retorna apenas ContratoDeDecisao.

- [ ] Metodo `solicitarDecisao` retorna `ContratoComMetadados`
- [ ] Campo `emitido_para` sempre igual a "Bazari"
- [ ] Nenhum dado interno exposto (verificado por teste)

### 4.3 Replay Deterministico

**Objetivo**: Confirmar que replay e consistente.

```bash
# Executar load test com verificacao de replay
npm run bazari:load-test 100
```

- [ ] `replay_deterministico: true` no resultado
- [ ] Dois replays consecutivos sao identicos

### 4.4 Chain Valida

**Objetivo**: Confirmar integridade do EventLog.

```bash
# Verificar via load test
npm run bazari:load-test 100

# Verificar campo no resultado
cat data-load-test/load-test-result.json | grep chain_valid
```

- [ ] `chain_valid: true`
- [ ] `verifyChain()` retorna `valid: true`

---

## 5. Validacao de Cenarios de Caos

### 5.1 Executar Drill Completo

```bash
# Executar drill com N episodios
npm run drill:go-live 50

# Verificar resultado
cat test-artifacts/go-live/<timestamp>/drill-result.json
```

- [ ] Cenario 1 (Corrupcao de Segmento): PASSOU
- [ ] Cenario 2 (Perda de Segmento): PASSOU
- [ ] Cenario 3 (Corrupcao de Snapshot): PASSOU
- [ ] Cenario 4 (Requisicoes Simultaneas): PASSOU
- [ ] Cenario 5 (Restart Inesperado): PASSOU
- [ ] Cenario 6 (Disco Cheio Simulado): PASSOU
- [ ] Cenario 7 (Restauracao de Backup): PASSOU

### 5.2 Verificar Garantias Pos-Drill

No resultado do drill, verificar:

- [ ] `garantias.sem_delete_update: true`
- [ ] `garantias.replay_deterministico: true`
- [ ] `garantias.adapter_funcional: true`
- [ ] `garantias.chain_valida_final: true`

---

## 6. Validacao de Backup/Restauracao

### 6.1 Criar Backup Frio

```bash
npm run backup-frio ./data ./backup-out
```

- [ ] Arquivo tar.gz criado
- [ ] Manifest JSON gerado
- [ ] `chain_valid_at_backup: true` no manifest

### 6.2 Testar Restauracao

```bash
# Simular restauracao em diretorio temporario
# (seguir runbook desastre_backup_frio.md)
```

- [ ] Restauracao bem-sucedida
- [ ] Chain valida apos restauracao
- [ ] Adapter funcional apos restauracao

---

## 7. Validacao de Load Test

### 7.1 Load Test Basico (N=100)

```bash
npm run bazari:load-test 100
```

- [ ] STATUS: PASSOU
- [ ] Taxa de sucesso: 100%
- [ ] Sem vazamento de dados

### 7.2 Load Test Estendido (N=1000) - Opcional

```bash
npm run bazari:load-test 1000
```

- [ ] STATUS: PASSOU (ou justificar se necessario ajustes)

---

## 8. Documentacao

### 8.1 Documentos Atualizados

- [ ] `docs/incrementos/incremento8_go_live.md` criado
- [ ] `docs/runbooks/checklist_go_live.md` criado (este documento)
- [ ] `docs/runbooks/garantias_integracao_bazari.md` atualizado
- [ ] `docs/canonico/modelos-entidades.md` atualizado (se necessario)

### 8.2 Estado Semanal

- [ ] `docs/estado/semana8_go_live.md` criado com resultados do drill

---

## 9. Aprovacao Final

### 9.1 Criterios Obrigatorios

| Criterio | Status | Verificado Por |
|----------|--------|----------------|
| Todos os testes passam | [ ] | |
| Drill go-live passa | [ ] | |
| Chain valida | [ ] | |
| Replay deterministico | [ ] | |
| Backup funcional | [ ] | |
| Adapter funcional | [ ] | |

### 9.2 Criterios Recomendados

| Criterio | Status | Notas |
|----------|--------|-------|
| Cobertura > 60% | [ ] | |
| Load test N=1000 OK | [ ] | |
| Dashboard gerado | [ ] | |

### 9.3 Assinaturas

| Papel | Nome | Data | Assinatura |
|-------|------|------|------------|
| Desenvolvedor | | | |
| Revisor | | | |
| Aprovador | | | |

---

## 10. Acoes Pos-Aprovacao

### 10.1 Se APROVADO

1. [ ] Merge para branch principal
2. [ ] Tag de release criada
3. [ ] Deploy em ambiente de producao
4. [ ] Monitoramento inicial ativo
5. [ ] Comunicacao para stakeholders

### 10.2 Se REPROVADO

1. [ ] Documentar motivo da reprovacao
2. [ ] Criar tarefas para correcao
3. [ ] Re-executar checklist apos correcoes
4. [ ] Atualizar documentacao de estado

---

## 11. Contatos

| Papel | Responsavel | Contato |
|-------|-------------|---------|
| Lider Tecnico | (preencher) | |
| DevOps | (preencher) | |
| Suporte | (preencher) | |

---

## 12. Historico de Execucoes

| Data | Versao | Resultado | Executado Por | Notas |
|------|--------|-----------|---------------|-------|
| | | | | |

---

*Documento gerado em: 2025-12-23*
*Versao do Sistema: Incremento 8*
