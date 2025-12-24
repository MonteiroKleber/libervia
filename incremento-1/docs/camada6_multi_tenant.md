# CAMADA 6 — MULTI-TENANT

## Objetivo

A Camada 6 permite que o Libervia (Cérebro Institucional) atenda múltiplas
instituições de forma isolada, segura e escalável — sem modificar o Core
(Camada 3).

### Responsabilidades

| Módulo             | Responsabilidade                                         |
| ------------------ | -------------------------------------------------------- |
| TenantConfig       | Tipos, quotas e features por tenant                      |
| TenantSecurity     | Validação de tenantId, prevenção de path traversal       |
| TenantRegistry     | CRUD de tenants, persistência em disco                   |
| TenantRuntime      | Cache e lifecycle de instâncias do Core                  |
| TenantRouter       | Extração de tenantId de requests HTTP                    |
| TenantAdminAPI     | Operações administrativas (auditoria, métricas, health)  |
| IntegrationAdapter | Interface genérica para integrações externas             |

---

## Garantias de Isolamento

### 1. Isolamento de Dados (Físico)

Cada tenant tem seu próprio diretório:

```
<baseDir>/
├── config/
│   └── tenants.json       # Registro de todos os tenants
└── tenants/
    ├── acme-corp/         # Tenant A
    │   ├── situacao-contexto.json
    │   ├── episodios.json
    │   ├── decisoes.json
    │   ├── contratos.json
    │   └── event-log/
    └── globex/            # Tenant B
        ├── situacao-contexto.json
        └── ...
```

**Garantia**: Tenant A nunca acessa arquivos de Tenant B.

### 2. Prevenção de Path Traversal

```typescript
// TenantSecurity.ts
const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

// IDs maliciosos são rejeitados:
// '../etc'        → INVÁLIDO (caracteres proibidos)
// '../../passwd'  → INVÁLIDO
// 'admin'         → INVÁLIDO (reservado)

// Mesmo se passar validação, path é verificado:
const resolved = path.resolve(baseDir, 'tenants', tenantId);
if (!resolved.startsWith(expectedPrefix)) {
  throw new Error('Path escape attempt');
}
```

### 3. Isolamento de Instâncias (Runtime)

Cada tenant recebe sua própria instância do Core:

```typescript
// TenantRuntime.ts
private instances: Map<string, CoreInstance> = new Map();

// Tenant A e B têm instâncias completamente separadas:
// - Repositórios separados (SituacaoRepo, EpisodioRepo, etc.)
// - EventLog separado
// - Orquestrador separado
```

### 4. Verificação de Isolamento (Testes)

O arquivo `tenantIsolation.test.ts` verifica:

- Diretórios físicos são distintos
- Dados de um tenant não vazam para outro
- EventLog é isolado por tenant
- Ataques de path traversal são bloqueados

---

## Topologias de Deploy

### Topologia A: Processo Único (Recomendado para início)

```
┌─────────────────────────────────────────────────────┐
│                   Processo Node.js                   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │              TenantRuntime                    │   │
│  │                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐            │   │
│  │  │ Core ACME   │  │ Core GLOBEX │  ...       │   │
│  │  │ (instância) │  │ (instância) │            │   │
│  │  └─────────────┘  └─────────────┘            │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    /tenants/       /tenants/      /tenants/
    acme-corp/      globex/        ...
```

**Vantagens**:
- Simples de operar
- Menor uso de memória base
- Lazy loading (instâncias criadas sob demanda)

**Desvantagens**:
- Um tenant com problemas pode afetar outros
- Escala vertical limitada

### Topologia B: Processo por Tenant

```
┌──────────────────┐   ┌──────────────────┐
│  Processo ACME   │   │  Processo GLOBEX │
│                  │   │                  │
│  ┌────────────┐  │   │  ┌────────────┐  │
│  │   Core     │  │   │  │   Core     │  │
│  │ (single)   │  │   │  │ (single)   │  │
│  └────────────┘  │   │  └────────────┘  │
└────────┬─────────┘   └────────┬─────────┘
         │                      │
         ▼                      ▼
    /tenants/              /tenants/
    acme-corp/             globex/
```

**Vantagens**:
- Isolamento total (crash de um não afeta outros)
- Escala horizontal
- Limites de memória/CPU por tenant

**Desvantagens**:
- Mais complexo de orquestrar
- Maior overhead de memória

### Quando usar cada topologia?

| Cenário                          | Topologia |
| -------------------------------- | --------- |
| Até 10 tenants, mesmo datacenter | A         |
| Tenants com SLAs diferentes      | B         |
| Requisitos regulatórios (LGPD)   | B         |
| Ambiente de desenvolvimento      | A         |
| Alta disponibilidade crítica     | B         |

---

## Por que "Core não conhece Tenant"?

### Princípio de Design

O Core (Camada 3) foi projetado para ser **agnóstico a multi-tenancy**:

```typescript
// OrquestradorCognitivo NÃO tem:
// - tenantId como parâmetro
// - Lógica de isolamento
// - Referências a outros tenants

// Ele apenas recebe repositórios no construtor:
constructor(
  situacaoRepo: SituacaoRepository,
  episodioRepo: EpisodioRepository,
  decisaoRepo: DecisaoRepository,
  contratoRepo: ContratoRepository,
  memoryService: MemoryQueryService,
  protocoloRepo: DecisionProtocolRepository,
  eventLog: EventLogRepository
)
```

### Vantagens

1. **Testabilidade**: Core pode ser testado sem infraestrutura multi-tenant
2. **Simplicidade**: Lógica cognitiva não mistura com lógica de infra
3. **Flexibilidade**: Mesmo Core funciona single-tenant ou multi-tenant
4. **Manutenção**: Mudanças em multi-tenant não afetam Core

### Como funciona na prática?

```typescript
// TenantRuntime cria instância isolada:
const situacaoRepo = await SituacaoRepositoryImpl.create(dataDir);
const episodioRepo = await EpisodioRepositoryImpl.create(dataDir);
// ... outros repos com mesmo dataDir

const orquestrador = new OrquestradorCognitivo(
  situacaoRepo,
  episodioRepo,
  // ... todos usando dataDir do tenant
);

// Core não sabe que é multi-tenant!
// Ele só vê seus repositórios normais.
```

---

## Como adicionar Integrações (sem acoplar)

### Interface Genérica

```typescript
// IntegrationAdapter.ts
export interface IntegrationAdapter {
  readonly name: string;

  init?(
    tenantId: string,
    dataDir: string,
    orquestrador: OrquestradorCognitivo
  ): Promise<void>;

  shutdown?(tenantId: string): Promise<void>;
  isHealthy?(tenantId: string): Promise<boolean>;
}
```

### Exemplo: Adapter para Sistema X

```typescript
// Em projeto EXTERNO (não no Core)
import { IntegrationAdapter } from 'libervia/tenant';
import { OrquestradorCognitivo } from 'libervia/orquestrador';

export class SistemaXAdapter implements IntegrationAdapter {
  readonly name = 'sistema-x';

  async init(tenantId: string, dataDir: string, orq: OrquestradorCognitivo) {
    // Conectar ao Sistema X
    // Registrar webhooks
    // Sincronizar dados iniciais
  }

  async shutdown(tenantId: string) {
    // Desconectar
    // Cleanup
  }

  async isHealthy(tenantId: string) {
    // Verificar conexão com Sistema X
    return true;
  }
}
```

### Registrando o Adapter

```typescript
import { TenantRegistry, TenantRuntime } from 'libervia/tenant';
import { SistemaXAdapter } from './SistemaXAdapter';

// Factory que cria adapter para tenants específicos
const integrationFactory = async (tenantId, dataDir, orq) => {
  // Verificar se tenant usa Sistema X
  const usaSistemaX = await verificarConfiguracao(tenantId);

  if (usaSistemaX) {
    const adapter = new SistemaXAdapter();
    await adapter.init(tenantId, dataDir, orq);
    return adapter;
  }

  return null; // Tenant não usa integração
};

// Inicializar runtime com factory
const registry = await TenantRegistry.create('./data');
const runtime = TenantRuntime.create(registry, integrationFactory);
```

### Por que não acoplar integrações no Core?

1. **Core é genérico**: Funciona para qualquer instituição
2. **Integrações são específicas**: Cada instituição tem seus sistemas
3. **Separação de concerns**: Core faz cognição, adapters fazem integração
4. **Manutenção independente**: Atualizar adapter não requer mudar Core

---

## API Administrativa

### Operações de Tenant

```typescript
const admin = TenantAdminAPI.create(registry, runtime);

// CRUD
await admin.registerTenant({ id: 'nova-inst', name: 'Nova Instituição' });
await admin.updateTenant('nova-inst', { quotas: { maxEvents: 50000 } });
await admin.suspendTenant('nova-inst');
await admin.resumeTenant('nova-inst');
await admin.removeTenant('nova-inst');

// Consultas
await admin.listTenants();
await admin.getTenant('nova-inst');
```

### Auditoria por Tenant

```typescript
// Verificar integridade da cadeia de eventos
await admin.verifyChain('acme-corp');
await admin.verifyFromSnapshot('acme-corp');

// Exportar eventos
await admin.exportEventLog('acme-corp', {
  fromSequence: 1000,
  toSequence: 2000
});

// Replay (reconstruir estado)
await admin.replayEventLog('acme-corp');
```

### Métricas e Health

```typescript
// Métricas de um tenant
await admin.getTenantMetrics('acme-corp');
// → { tenantId, startedAt, lastActivity, uptime, eventLogStatus }

// Métricas globais
await admin.getGlobalMetrics();
// → { totalTenants, activeTenants, suspendedTenants, activeInstances, ... }

// Health check
await admin.healthCheck();
// → { healthy: true, registry: true, runtime: true, details: { ... } }
```

---

## Configuração de Quotas

Cada tenant pode ter quotas específicas:

```typescript
interface TenantQuotas {
  maxEvents: number;      // Máximo de eventos no EventLog
  maxStorageMB: number;   // Limite de armazenamento
  rateLimitRpm: number;   // Requests por minuto
}

// Defaults
const DEFAULT_QUOTAS = {
  maxEvents: 10_000_000,  // 10M eventos
  maxStorageMB: 10_240,   // 10GB
  rateLimitRpm: 1000      // 1000 req/min
};

// Customização
await registry.register({
  id: 'small-inst',
  name: 'Instituição Pequena',
  quotas: {
    maxEvents: 100_000,   // Apenas 100K eventos
    maxStorageMB: 1024    // 1GB
  }
});
```

---

## Features por Tenant

Funcionalidades podem ser habilitadas/desabilitadas:

```typescript
interface TenantFeatures {
  signedBackup: boolean;     // Backup com assinatura digital
  externalAudit: boolean;    // Auditoria externa
  advancedMetrics: boolean;  // Métricas avançadas
}

// Por padrão, tudo desabilitado
const DEFAULT_FEATURES = {
  signedBackup: false,
  externalAudit: false,
  advancedMetrics: false
};

// Habilitar para tenant específico
await registry.update('premium-inst', {
  features: {
    signedBackup: true,
    advancedMetrics: true
  }
});
```

---

## Segurança

### Validação de TenantId

```typescript
// Regex rigoroso
const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

// IDs reservados (não podem ser usados)
const RESERVED_IDS = [
  'admin', 'system', 'config', 'backup', 'logs',
  'tenants', 'api', 'public', 'private', 'internal',
  'root', 'null', 'undefined'
];

// Normalização automática
'ACME-Corp' → 'acme-corp'
```

### Prevenção de Ataques

1. **Path Traversal**: Validação + resolução de path
2. **Symlink Attack**: Modo paranoid com fs.realpath()
3. **ID Squatting**: IDs reservados não podem ser usados
4. **Injection**: Regex impede caracteres especiais

---

## Exemplo Completo

```typescript
import {
  TenantRegistry,
  TenantRuntime,
  TenantAdminAPI,
  TenantRouter
} from 'libervia/tenant';

async function main() {
  // 1. Criar registry
  const registry = await TenantRegistry.create('./data');

  // 2. Criar runtime (sem integração específica)
  const runtime = TenantRuntime.create(registry);

  // 3. Registrar tenants
  await registry.register({ id: 'hospital-a', name: 'Hospital A' });
  await registry.register({ id: 'tribunal-b', name: 'Tribunal B' });

  // 4. Obter Core de um tenant
  const instance = await runtime.getOrCreate('hospital-a');

  // 5. Usar o Core normalmente
  await instance.orquestrador.registrarSituacao({
    fato: 'Paciente chegou',
    contexto: { setor: 'Emergência' },
    timestamp: new Date().toISOString()
  });

  // 6. Admin API
  const admin = TenantAdminAPI.create(registry, runtime);
  const metrics = await admin.getGlobalMetrics();
  console.log(metrics);

  // 7. Shutdown
  await runtime.shutdownAll();
}
```

---

## Resumo

| Aspecto              | Garantia                                          |
| -------------------- | ------------------------------------------------- |
| Isolamento de dados  | Diretórios físicos separados                      |
| Segurança            | Validação de ID + prevenção de path traversal     |
| Independência        | Core não conhece conceito de tenant               |
| Extensibilidade      | IntegrationAdapter genérico e plugável            |
| Operação             | Admin API para gerenciamento                      |
| Flexibilidade        | Topologia A (único) ou B (por tenant)             |
