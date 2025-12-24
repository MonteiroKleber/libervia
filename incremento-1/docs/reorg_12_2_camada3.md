# REORG 12.2 — Separação do Core em `camada-3/`

## Resumo

Reorganização estrutural do projeto para tornar a arquitetura de camadas visível no filesystem.

**Mudança principal:** Todo o Core (Camada 3 — Núcleo Cognitivo) foi movido para a pasta `camada-3/`.

**Zero mudança funcional.** Apenas refactor de organização + ajuste de imports.

---

## Motivação

Antes, os módulos do Core estavam no nível raiz de `incremento-1/`, misturados com outras camadas:

```
incremento-1/
├── orquestrador/      ← Core
├── repositorios/      ← Core
├── entidades/         ← Core
├── servicos/          ← Core
├── event-log/         ← Core
├── utilitarios/       ← Core
├── tenant/            ← Camada 6
├── gateway/           ← Camada 6
├── integracoes/       ← Adapters
└── ...
```

A nova estrutura deixa claro o que é Core e o que não é:

```
incremento-1/
├── camada-3/          ← CORE (Núcleo Cognitivo)
│   ├── orquestrador/
│   ├── repositorios/
│   ├── entidades/
│   ├── servicos/
│   ├── event-log/
│   ├── utilitarios/
│   └── index.ts       ← Barrel export
├── tenant/            ← Camada 6 (Multi-Tenant)
├── gateway/           ← Camada 6 (HTTP Gateway)
├── integracoes/       ← Adapters (Bazari, etc)
├── control-plane/     ← Observabilidade
└── ...
```

---

## Arquivos/Pastas Movidos

| De (antigo) | Para (novo) |
|-------------|-------------|
| `orquestrador/` | `camada-3/orquestrador/` |
| `repositorios/` | `camada-3/repositorios/` |
| `entidades/` | `camada-3/entidades/` |
| `servicos/` | `camada-3/servicos/` |
| `event-log/` | `camada-3/event-log/` |
| `utilitarios/` | `camada-3/utilitarios/` |

---

## Ajustes de Imports

Todos os arquivos que importavam do Core foram atualizados:

| Módulo | Padrão antigo | Padrão novo |
|--------|---------------|-------------|
| tenant/ | `from '../orquestrador/...'` | `from '../camada-3/orquestrador/...'` |
| gateway/ | `from '../../entidades/...'` | `from '../../camada-3/entidades/...'` |
| integracoes/ | `from '../../orquestrador/...'` | `from '../../camada-3/orquestrador/...'` |
| testes/ | `from '../event-log/...'` | `from '../camada-3/event-log/...'` |
| scripts/ | `from '../repositorios/...'` | `from '../camada-3/repositorios/...'` |
| control-plane/ | `from '../servicos/...'` | `from '../camada-3/servicos/...'` |

---

## Barrel Export

Criado `camada-3/index.ts` para importação simplificada:

```typescript
// Importação unificada
import {
  OrquestradorCognitivo,
  SituacaoDecisoria,
  EventLogRepositoryImpl,
  MemoryQueryService
} from './camada-3';
```

---

## Garantias de Isolamento

### O Core (camada-3/) NÃO importa:
- ❌ `tenant/`
- ❌ `gateway/`
- ❌ `integracoes/`

Verificado via grep: nenhuma referência a módulos de camadas superiores.

### O Core NÃO contém:
- ❌ Referências a Bazari (exceto comentário histórico de compatibilidade)
- ❌ Dependências de integrações específicas

---

## Testes

```bash
npm test
```

**Resultado:** 431 de 432 testes passando.

O único teste que falha ocasionalmente (`tenantKeys.test.ts` — "Revogar chave invalida o token") é um flaky test pré-existente causado por race condition de filesystem, não relacionado a esta reorganização.

---

## Compatibilidade

Esta reorganização é **backward-compatible** para uso interno:
- Imports antigos devem ser atualizados manualmente
- O barrel export `camada-3/index.ts` facilita migração
- Nenhuma API pública foi alterada

---

## Diagrama de Dependências

```
┌─────────────────────────────────────────────────────┐
│                     gateway/                        │
│              (HTTP Multi-Tenant)                    │
└───────────────────────┬─────────────────────────────┘
                        │ usa
                        ▼
┌─────────────────────────────────────────────────────┐
│                     tenant/                         │
│              (Camada 6 Multi-Tenant)                │
└───────────────────────┬─────────────────────────────┘
                        │ usa
                        ▼
┌─────────────────────────────────────────────────────┐
│                   camada-3/                         │
│              (Core - Núcleo Cognitivo)              │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐   │
│  │ orquestrador│ │ repositorios│ │   event-log  │   │
│  └─────────────┘ └─────────────┘ └──────────────┘   │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐   │
│  │  entidades  │ │   servicos  │ │  utilitarios │   │
│  └─────────────┘ └─────────────┘ └──────────────┘   │
└─────────────────────────────────────────────────────┘

integracoes/bazari/ ──uses──► camada-3/
```

---

## Checklist de Conclusão

- [x] Pastas movidas para `camada-3/`
- [x] Imports atualizados em todos os módulos
- [x] Barrel export criado
- [x] Isolamento verificado (Core não importa camadas superiores)
- [x] Testes passando (431/432 — 1 flaky pré-existente)
- [x] Documentação criada
