# INCREMENTO 21 — Painel Operacional (Admin UI + Query APIs)

## Resumo Executivo

O Incremento 21 entrega o **Painel Operacional**, uma interface administrativa para consulta e monitoramento do sistema Libervia em produção. Composto por APIs de leitura (Query APIs) e uma interface web leve (Admin UI), o painel permite que papéis institucionais — Guardião do Mandato, Comitê de Risco, Operações Sênior, Auditoria e Engenharia de Plataforma — acompanhem mandatos de autonomia, casos de revisão humana, consequências aplicadas e o log de eventos em tempo real. O acesso é controlado via RBAC, garantindo que cada papel visualize apenas o que lhe compete.

---

## O que é o Painel Operacional

O Painel Operacional é uma **ferramenta de consulta e monitoramento** que expõe, via APIs REST e interface web:

1. **Mandatos de Autonomia** — configurações vigentes de cada tenant sobre os poderes delegados ao Core
2. **Casos de Revisão Humana** — episódios flagados para análise manual antes de prosseguir
3. **Consequências Aplicadas** — ações tomadas pelo sistema (alertas, bloqueios, flags)
4. **Timeline de Observações** — histórico de fatos observados pelo Core
5. **EventLog** — registro de auditoria completo de todos os eventos do sistema
6. **Dashboard** — visão consolidada de métricas por tenant

Todas as operações são **somente-leitura**. Nenhuma modificação de estado ocorre via Painel.

---

## O que este painel não é

- **Não é uma ferramenta de configuração** — mandatos são gerenciados via Admin API (`/admin/tenants/:id/mandate`)
- **Não é interface de operação do Core** — o Core opera autonomamente conforme seu mandato
- **Não é substituto para logs de infraestrutura** — EventLog é semântico (negócio), não técnico (infra)
- **Não é sistema de alertas** — não dispara notificações; apenas exibe estado atual
- **Não é dashboard de BI** — métricas são operacionais, não analíticas

---

## Quem utiliza dentro da instituição

### Guardião do Mandato
**Responsabilidade**: Aprovar, ajustar e monitorar mandatos de autonomia por tenant.
**Uso típico**: Visualizar mandatos vigentes, verificar se consequências disparadas condizem com limites configurados, acompanhar casos de revisão humana pendentes.
**Acesso**: `global_admin` (visão de todos os tenants) ou `tenant_admin` (seu tenant específico).

### Comitê de Risco
**Responsabilidade**: Avaliar exposição a risco e validar que o sistema opera dentro de parâmetros aceitáveis.
**Uso típico**: Consultar consequências do tipo `FLAG_HUMAN_REVIEW` e `BLOCK_OPERATION`, revisar timeline de observações de alto impacto, auditar decisões tomadas.
**Acesso**: `global_admin` para visão consolidada multi-tenant.

### Operações Sênior
**Responsabilidade**: Garantir continuidade operacional e resolver incidentes.
**Uso típico**: Monitorar dashboard de instâncias ativas, identificar tenants com problemas, consultar EventLog para diagnóstico.
**Acesso**: `global_admin` para operação cross-tenant.

### Auditoria
**Responsabilidade**: Garantir conformidade regulatória e rastreabilidade de decisões.
**Uso típico**: Exportar EventLog para análise, verificar cadeia completa de um episódio (observação → consequência → revisão), validar que mandatos foram respeitados.
**Acesso**: `global_admin` com foco em leitura de EventLog e rastreabilidade.

### Engenharia de Plataforma
**Responsabilidade**: Manter a infraestrutura do sistema e suportar troubleshooting.
**Uso típico**: Verificar instâncias ativas, consultar métricas de request, diagnosticar problemas via EventLog e timeline.
**Acesso**: `global_admin` para acesso completo.

---

## Mapeamento RBAC → Papéis

| Papel Institucional         | Role RBAC        | Escopo de Acesso                      |
|-----------------------------|------------------|---------------------------------------|
| Guardião do Mandato (global)| `global_admin`   | Todos os tenants                      |
| Guardião do Mandato (tenant)| `tenant_admin`   | Apenas seu tenant                     |
| Comitê de Risco             | `global_admin`   | Todos os tenants                      |
| Operações Sênior            | `global_admin`   | Todos os tenants                      |
| Auditoria                   | `global_admin`   | Todos os tenants (foco em EventLog)   |
| Engenharia de Plataforma    | `global_admin`   | Todos os tenants                      |

**Regras de Acesso:**
- `global_admin`: Acessa qualquer endpoint, qualquer tenant
- `tenant_admin`: Acessa apenas endpoints `/admin/query/tenant/:tenantId/*` do seu próprio tenant
- `public`: Sem acesso às Query APIs (401 Unauthorized)

---

## Fluxos típicos do Painel

### Fluxo 1: Monitoramento de Revisões Pendentes
1. Guardião acessa **Dashboard** → vê contadores de `reviewsPending`
2. Navega para **Revisões** → lista casos com status `pending`
3. Clica em caso específico → vê detalhes: episódio original, consequência que gerou a flag, notas
4. Externamente (fora do painel) toma ação sobre o caso
5. Sistema atualiza status do ReviewCase para `approved`/`rejected`

### Fluxo 2: Auditoria de Consequência Específica
1. Auditor acessa **Consequências** de um tenant
2. Filtra por tipo `BLOCK_OPERATION`
3. Seleciona consequência → vê `observacaoId` e `episodioId` relacionados
4. Navega para **Timeline** → busca observação original
5. Verifica cadeia: observação → regra → consequência
6. Exporta dados para relatório de compliance

### Fluxo 3: Diagnóstico de Incidente
1. Operações Sênior recebe alerta de problema em tenant X
2. Acessa **Dashboard** → verifica métricas do tenant
3. Consulta **EventLog** → filtra por `tenantId` e período do incidente
4. Identifica sequência de eventos que levou ao problema
5. Correlaciona com **Timeline** para entender contexto de negócio

### Fluxo 4: Validação de Mandato
1. Comitê de Risco precisa validar configuração de tenant novo
2. Acessa **Mandatos** → localiza tenant
3. Revisa: `maxAutonomyLevel`, `requiresHumanApproval`, `allowedActions`
4. Compara com política institucional de risco
5. Confirma ou solicita ajuste via Admin API

### Fluxo 5: Análise de Observação
1. Guardião quer entender comportamento do Core em episódio específico
2. Acessa **Timeline** → busca por `episodioId`
3. Vê sequência completa de observações do episódio
4. Para cada observação relevante, consulta consequências geradas
5. Valida que Core operou conforme mandato vigente

---

## Entidades e rastreabilidade

### Cadeia de Rastreabilidade

```
Tenant
  └── AutonomyMandate (configuração de poderes)
        └── Observação (fato observado)
              └── Consequência (ação derivada)
                    └── ReviewCase (se FLAG_HUMAN_REVIEW)
                          └── Decisão (approved/rejected)
```

### Chaves de Correlação

| Entidade      | Identificador Único | Correlação                          |
|---------------|---------------------|-------------------------------------|
| Tenant        | `tenantId`          | —                                   |
| Mandate       | `tenantId`          | 1:1 com Tenant                      |
| Observação    | `id` (uuid)         | `episodioId`, `contratoId`          |
| Consequência  | `id` (uuid)         | `observacaoId`, `episodioId`        |
| ReviewCase    | `id` (uuid)         | `episodioId`, `consequenceId`       |
| EventLog      | `requestId`         | `tenantId`, qualquer entidade       |

### X-Request-Id

Todas as requisições ao Painel incluem header `X-Request-Id` na resposta, permitindo correlação com EventLog para auditoria de quem consultou o quê.

---

## Operação e segurança

### Autenticação
- **Admin Token**: Header `Authorization: Bearer <token>`
- Token de `global_admin`: Acesso completo
- Token de `tenant_admin`: Acesso restrito ao tenant vinculado

### Rate Limiting
- Query APIs seguem rate limiting configurado no gateway
- Default: 100 req/min por IP para endpoints admin

### Logs de Acesso
- Toda requisição às Query APIs é registrada no EventLog
- Campos: `requestId`, `role`, `tenantId`, `endpoint`, `timestamp`

### Dados Sensíveis
- Painel não expõe credenciais ou tokens
- Observações podem conter dados de negócio — acesso restrito por RBAC

### Headers de Segurança
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy`: restritivo para Admin UI

---

## Glossário curto

| Termo               | Definição                                                                 |
|---------------------|---------------------------------------------------------------------------|
| **Mandato**         | Configuração de autonomia delegada ao Core para um tenant                 |
| **Observação**      | Fato registrado pelo Core durante processamento de um episódio            |
| **Consequência**    | Ação tomada pelo sistema em resposta a uma observação                     |
| **ReviewCase**      | Caso pendente de revisão humana antes de prosseguir                       |
| **EventLog**        | Registro de auditoria de todos os eventos do sistema                      |
| **Episódio**        | Unidade de processamento (ex: análise de um contrato)                     |
| **Tenant**          | Inquilino isolado no sistema multi-tenant                                 |
| **RBAC**            | Role-Based Access Control — controle de acesso por papel                  |
| **global_admin**    | Papel com acesso a todos os tenants                                       |
| **tenant_admin**    | Papel com acesso apenas ao seu tenant                                     |
| **Query API**       | API de consulta somente-leitura                                           |
| **Admin UI**        | Interface web do Painel Operacional                                       |

---

## Checklist de uso correto

### Para Guardiões do Mandato
- [ ] Verifico regularmente o dashboard para casos de revisão pendentes
- [ ] Consulto mandatos antes de aprovar mudanças de autonomia
- [ ] Uso filtros de tenant para focar no escopo de minha responsabilidade

### Para Comitê de Risco
- [ ] Reviso consequências do tipo `BLOCK_OPERATION` semanalmente
- [ ] Valido que mandatos de novos tenants seguem política de risco
- [ ] Correlaciono observações com consequências para entender decisões

### Para Operações Sênior
- [ ] Monitoro dashboard de instâncias para detectar anomalias
- [ ] Uso EventLog como primeira fonte de diagnóstico
- [ ] Mantenho familiaridade com timeline para contexto de negócio

### Para Auditoria
- [ ] Exporto EventLog periodicamente para análise offline
- [ ] Verifico rastreabilidade completa (observação → consequência → revisão)
- [ ] Documento consultas realizadas para compliance

### Para Engenharia de Plataforma
- [ ] Verifico métricas de request para capacity planning
- [ ] Uso `X-Request-Id` para correlacionar logs técnicos com EventLog
- [ ] Monitoro instâncias ativas para health check de tenants

---

## Endpoints da Query API

### Globais (requerem `global_admin`)

| Método | Endpoint                      | Descrição                           |
|--------|-------------------------------|-------------------------------------|
| GET    | `/admin/query/tenants`        | Lista todos os tenants              |
| GET    | `/admin/query/instances`      | Lista instâncias ativas             |
| GET    | `/admin/query/metrics`        | Métricas globais do gateway         |
| GET    | `/admin/query/eventlog`       | EventLog global (paginado)          |

### Por Tenant (requerem `global_admin` ou `tenant_admin` do tenant)

| Método | Endpoint                                          | Descrição                           |
|--------|---------------------------------------------------|-------------------------------------|
| GET    | `/admin/query/tenant/:tenantId/mandates`          | Mandatos do tenant                  |
| GET    | `/admin/query/tenant/:tenantId/reviews`           | Casos de revisão                    |
| GET    | `/admin/query/tenant/:tenantId/consequences`      | Consequências aplicadas             |
| GET    | `/admin/query/tenant/:tenantId/episodes/:id`      | Observações de um episódio          |
| GET    | `/admin/query/tenant/:tenantId/contracts/:id`     | Observações de um contrato          |
| GET    | `/admin/query/tenant/:tenantId/dashboard`         | Dashboard consolidado do tenant     |

### Parâmetros de Paginação

- `limit`: Número máximo de registros (default: 100)
- `offset`: Posição inicial (default: 0)

---

## Acesso ao Admin UI

O Painel Operacional está disponível em:

```
GET /admin/ui
```

### Requisitos
1. Token de autenticação (`global_admin` ou `tenant_admin`)
2. Navegador moderno (Chrome, Firefox, Safari, Edge)

### Uso
1. Acesse `/admin/ui` no navegador
2. Insira seu token de autenticação
3. Sistema detecta automaticamente seu papel (global_admin/tenant_admin)
4. Navegue pelas views: Dashboard, Revisões, Mandatos, Consequências, Timeline, EventLog

---

## Histórico de Versões

| Versão | Data       | Descrição                                    |
|--------|------------|----------------------------------------------|
| 1.0    | 2025-12-27 | Implementação inicial — Query APIs + Admin UI |
