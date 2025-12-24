# Camada 6 — Multi-Tenant: Análise e Projeto

**Data**: 2025-12-23
**Versão**: 1.0
**Status**: ANÁLISE/PROJETO (sem implementação)
**Autor**: Libervia

---

## Sumário Executivo

Este documento analisa a viabilidade e projeta a **Camada 6 (Multi-Tenant)** para o Cérebro Institucional Libervia, permitindo que múltiplas instituições utilizem a mesma base de código com isolamento completo de dados.

### Conclusões Principais

| Aspecto | Decisão/Recomendação |
|---------|---------------------|
| **Mudanças no Core (Camada 3)** | **ZERO MUDANÇAS** — Core já é tenant-ready por design |
| **Topologia Recomendada** | Instância isolada por tenant (produção inicial) |
| **Padrão de Diretórios** | `data/<tenantId>/` com validação rigorosa |
| **Onde vive a Camada 6** | Nova pasta `tenant/` no mesmo nível de `orquestrador/` |
| **Impacto em Testes** | Nenhum — testes do Core continuam passando |

### Diagrama de Arquitetura (Visão Macro)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CAMADA 6 - MULTI-TENANT                            │
│                                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │TenantRegistry│  │TenantRouter │  │TenantRuntime│  │   Admin/Audit API       │ │
│  │             │  │             │  │             │  │                         │ │
│  │• register() │  │• resolve()  │  │• getCore()  │  │• listTenants()          │ │
│  │• getConfig()│  │• validate() │  │• shutdown() │  │• exportRange(tenantId)  │ │
│  │• suspend()  │  │             │  │             │  │• verifyChain(tenantId)  │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                │                     │               │
│         └────────────────┴────────────────┴─────────────────────┘               │
│                                           │                                     │
└───────────────────────────────────────────┼─────────────────────────────────────┘
                                            │ Cria instâncias isoladas
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CAMADA 4/5 - ADAPTER (por tenant)                       │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    BazariAdapter (instância por tenant)                 │    │
│  └──────────────────────────────────┬──────────────────────────────────────┘    │
└─────────────────────────────────────┼───────────────────────────────────────────┘
                                      │
                                      ▼
╔═════════════════════════════════════════════════════════════════════════════════╗
║                         CAMADA 3 - LIBERVIA CORE (inalterada)                   ║
║                                                                                 ║
║  ┌───────────────────────────────────────────────────────────────────────────┐  ║
║  │                      ORQUESTRADOR COGNITIVO                               │  ║
║  │                      (uma instância por tenant)                           │  ║
║  └───────────────────────────────────────────────────────────────────────────┘  ║
║          │                           │                           │              ║
║          ▼                           ▼                           ▼              ║
║  ┌───────────────┐          ┌───────────────┐          ┌───────────────┐        ║
║  │  Repositórios │          │   Entidades   │          │   EventLog    │        ║
║  │ (dataDir/X)   │          │               │          │ (dataDir/X)   │        ║
║  └───────────────┘          └───────────────┘          └───────────────┘        ║
╚═════════════════════════════════════════════════════════════════════════════════╝
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FILESYSTEM (por tenant)                            │
│                                                                                 │
│   data/                                                                         │
│   ├── tenant-acme/                    ├── tenant-globex/                        │
│   │   ├── situacoes.json              │   ├── situacoes.json                    │
│   │   ├── episodios.json              │   ├── episodios.json                    │
│   │   ├── decisoes.json               │   ├── decisoes.json                     │
│   │   ├── contratos.json              │   ├── contratos.json                    │
│   │   ├── protocolos.json             │   ├── protocolos.json                   │
│   │   ├── event-log/                  │   ├── event-log/                        │
│   │   │   └── segment-*.json          │   │   └── segment-*.json                │
│   │   └── event-log-snapshot.json     │   └── event-log-snapshot.json           │
│   └── ...                             └── ...                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Camada 6: Definição

### 1.1 O que é a Camada 6?

A **Camada 6** é a camada de **orquestração multi-tenant** que permite:

- **Múltiplas instituições** usarem o mesmo código Libervia
- **Isolamento completo** de dados entre tenants
- **Gestão centralizada** de configurações, quotas e lifecycle
- **Auditoria independente** por tenant

A Camada 6 **NÃO** altera a lógica do Core — apenas **instancia e gerencia** múltiplas instâncias isoladas do Core.

### 1.2 Responsabilidades da Camada 6

| Responsabilidade | Descrição |
|------------------|-----------|
| **Registro de Tenants** | Cadastrar, configurar, suspender, remover tenants |
| **Isolamento de Dados** | Garantir que cada tenant opera em dataDir próprio |
| **Lifecycle Management** | Inicializar, pausar, encerrar instâncias por tenant |
| **Roteamento** | Resolver `tenantId` → instância do Core |
| **Quotas e Limites** | Impor limites de eventos, storage, rate limiting |
| **Admin API** | Expor operações administrativas (backup, export, verify) |
| **Auditoria Centralizada** | Consolidar métricas e status de todos os tenants |

### 1.3 APIs Públicas Expostas

```
┌─────────────────────────────────────────────────────────────────┐
│                    CAMADA 6: APIs PÚBLICAS                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TENANT MANAGEMENT                                              │
│  ─────────────────                                              │
│  • registerTenant(config: TenantConfig): Promise<TenantInfo>    │
│  • getTenant(tenantId: string): TenantInfo | null               │
│  • suspendTenant(tenantId: string): Promise<void>               │
│  • resumeTenant(tenantId: string): Promise<void>                │
│  • deleteTenant(tenantId: string): Promise<void>                │
│  • listTenants(): TenantInfo[]                                  │
│                                                                 │
│  CORE ACCESS (por tenant)                                       │
│  ────────────────────────                                       │
│  • getOrquestrador(tenantId: string): OrquestradorCognitivo     │
│  • getAdapter(tenantId: string): BazariAdapter                  │
│                                                                 │
│  AUDIT/ADMIN (por tenant)                                       │
│  ────────────────────────                                       │
│  • exportEventLog(tenantId, range): Promise<EventLogEntry[]>    │
│  • verifyChain(tenantId): Promise<ChainVerificationResult>      │
│  • replayEventLog(tenantId): Promise<ReplaySummary>             │
│  • backupTenant(tenantId, destino): Promise<BackupResult>       │
│  • getMetrics(tenantId): Promise<TenantMetrics>                 │
│                                                                 │
│  GLOBAL ADMIN                                                   │
│  ────────────                                                   │
│  • getGlobalMetrics(): Promise<GlobalMetrics>                   │
│  • healthCheck(): Promise<HealthStatus>                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.4 Limites e Garantias

| Limite/Garantia | Descrição | Default |
|-----------------|-----------|---------|
| **Isolamento de Dados** | Tenant A nunca acessa dados de Tenant B | Obrigatório |
| **Eventos por Tenant** | Máximo de eventos no EventLog | 10M |
| **Storage por Tenant** | Espaço em disco máximo | 10 GB |
| **Rate Limit** | Solicitações por minuto | 1000 |
| **Segmentos Retidos** | Segmentos do EventLog mantidos | 30 |
| **Backup Obrigatório** | Backup automático semanal | Configurável |

---

## 2. Topologias Suportadas

### 2.1 Comparação Objetiva

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TOPOLOGIAS MULTI-TENANT                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   OPÇÃO A: INSTÂNCIA ISOLADA                OPÇÃO B: MULTI-TENANT              │
│   ─────────────────────────                 ─────────────────────              │
│                                                                                 │
│   ┌─────────────┐  ┌─────────────┐         ┌─────────────────────────────────┐  │
│   │  Processo 1 │  │  Processo 2 │         │         Processo Único          │  │
│   │             │  │             │         │                                 │  │
│   │  ┌───────┐  │  │  ┌───────┐  │         │  ┌───────┐ ┌───────┐ ┌───────┐  │  │
│   │  │Tenant │  │  │  │Tenant │  │         │  │Tenant │ │Tenant │ │Tenant │  │  │
│   │  │  ACME │  │  │  │GLOBEX │  │         │  │  ACME │ │GLOBEX │ │ INITECH│ │  │
│   │  └───────┘  │  │  └───────┘  │         │  └───────┘ └───────┘ └───────┘  │  │
│   │             │  │             │         │                                 │  │
│   │  data/acme/ │  │data/globex/ │         │  data/acme/ globex/ initech/    │  │
│   └─────────────┘  └─────────────┘         └─────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Análise Detalhada

| Critério | A: Instância Isolada | B: Multi-Tenant Processo |
|----------|---------------------|-------------------------|
| **Isolamento de Memória** | ✅ Total (processos separados) | ⚠️ Parcial (mesmo heap) |
| **Isolamento de CPU** | ✅ Pode usar cgroups | ⚠️ Compartilhado |
| **Vazamento de Dados** | ✅ Impossível por design | ⚠️ Depende de validação |
| **Crash Isolation** | ✅ Crash de A não afeta B | ❌ Crash derruba todos |
| **Simplicidade Operacional** | ⚠️ Múltiplos processos | ✅ Um único processo |
| **Uso de Memória** | ⚠️ N × overhead Node.js | ✅ Compartilha runtime |
| **Escalabilidade Horizontal** | ✅ Excelente (stateless) | ⚠️ Requer sharding |
| **Deploy/Rollback** | ⚠️ Por tenant | ✅ Global |
| **Debugging** | ✅ Logs isolados | ⚠️ Logs misturados |
| **Custo Infra (poucos tenants)** | ⚠️ Maior | ✅ Menor |
| **Custo Infra (muitos tenants)** | ✅ Linear, previsível | ⚠️ Pode estourar memória |

### 2.3 Riscos por Topologia

#### Opção A: Instância Isolada

| Risco | Mitigação |
|-------|-----------|
| Overhead de processos | Usar containers leves (Alpine) |
| Complexidade de deploy | Orquestrador (K8s, Docker Compose) |
| Sync de versões | CI/CD centralizado |

#### Opção B: Multi-Tenant Processo

| Risco | Mitigação |
|-------|-----------|
| Memory leak de um tenant afeta todos | Limites de heap por tenant (difícil em Node) |
| Vazamento por bug de código | Code review rigoroso, validação de tenantId |
| Noisy neighbor (CPU) | Rate limiting agressivo |
| Crash global | Supervisão + restart automático |

### 2.4 Recomendação para Produção Inicial

```
╔═════════════════════════════════════════════════════════════════════════════════╗
║  RECOMENDAÇÃO: OPÇÃO A — INSTÂNCIA ISOLADA POR TENANT                           ║
╠═════════════════════════════════════════════════════════════════════════════════╣
║                                                                                 ║
║  RAZÕES:                                                                        ║
║  1. Segurança máxima — isolamento de processo garante zero vazamento            ║
║  2. Simplicidade de raciocínio — cada tenant é uma "instalação" completa        ║
║  3. Crash isolation — falha de um tenant não afeta outros                       ║
║  4. Auditoria clara — logs e métricas por processo                              ║
║  5. Escalabilidade horizontal natural — adicionar mais containers               ║
║                                                                                 ║
║  QUANDO MIGRAR PARA OPÇÃO B:                                                    ║
║  - Quando houver centenas de tenants pequenos                                   ║
║  - Quando custo de infra for crítico                                            ║
║  - Quando equipe tiver maturidade em multi-tenancy                              ║
║                                                                                 ║
╚═════════════════════════════════════════════════════════════════════════════════╝
```

---

## 3. Isolamento e Data Dir

### 3.1 Padrão Canônico de Diretórios

```
/var/lib/libervia/                    # Raiz de dados (configurável)
├── tenants/                          # Dados de todos os tenants
│   ├── acme-corp/                    # Tenant: ACME Corporation
│   │   ├── situacoes.json
│   │   ├── episodios.json
│   │   ├── decisoes.json
│   │   ├── contratos.json
│   │   ├── protocolos.json
│   │   ├── event-log/
│   │   │   ├── segment-000001.json
│   │   │   ├── segment-000002.json
│   │   │   └── ...
│   │   └── event-log-snapshot.json
│   │
│   ├── globex-inc/                   # Tenant: Globex Inc
│   │   ├── situacoes.json
│   │   ├── ...
│   │   └── event-log/
│   │
│   └── initech-llc/                  # Tenant: Initech LLC
│       └── ...
│
├── config/                           # Configurações globais
│   ├── tenants.json                  # Registry de tenants
│   └── global.json                   # Config global
│
├── backups/                          # Backups por tenant
│   ├── acme-corp/
│   │   ├── backup-20251223-020000.tar.gz
│   │   └── backup-20251223-020000.manifest.json
│   └── ...
│
└── logs/                             # Logs por tenant (opcional)
    ├── acme-corp/
    └── ...
```

### 3.2 Regras de Nomenclatura de TenantId

```typescript
/**
 * TenantId: Identificador único do tenant
 *
 * REGRAS:
 * - Apenas: a-z, 0-9, hífen (-)
 * - Comprimento: 3-50 caracteres
 * - Não pode começar/terminar com hífen
 * - Case-insensitive (normalizado para lowercase)
 * - Não pode ser: "admin", "system", "config", "backup", "logs"
 */
const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const RESERVED_IDS = ['admin', 'system', 'config', 'backup', 'logs', 'tenants'];

function validateTenantId(id: string): { valid: boolean; error?: string } {
  const normalized = id.toLowerCase().trim();

  if (normalized.length < 3 || normalized.length > 50) {
    return { valid: false, error: 'TenantId deve ter 3-50 caracteres' };
  }

  if (!TENANT_ID_REGEX.test(normalized)) {
    return { valid: false, error: 'TenantId inválido: use apenas a-z, 0-9, hífen' };
  }

  if (RESERVED_IDS.includes(normalized)) {
    return { valid: false, error: `TenantId reservado: ${normalized}` };
  }

  return { valid: true };
}
```

### 3.3 Prevenção de Path Traversal

```typescript
/**
 * Resolve dataDir de forma SEGURA para um tenant
 *
 * PROTEÇÕES:
 * 1. Validação rigorosa do tenantId
 * 2. Normalização de path (resolve . e ..)
 * 3. Verificação de que resultado está DENTRO do baseDir
 * 4. Sem symlinks (resolve real path)
 */
function resolveTenantDataDir(baseDir: string, tenantId: string): string {
  // 1. Validar tenantId
  const validation = validateTenantId(tenantId);
  if (!validation.valid) {
    throw new Error(`TenantId inválido: ${validation.error}`);
  }

  // 2. Normalizar tenantId
  const normalizedId = tenantId.toLowerCase().trim();

  // 3. Construir path
  const candidatePath = path.join(baseDir, 'tenants', normalizedId);

  // 4. Resolver para path absoluto (elimina . e ..)
  const resolvedPath = path.resolve(candidatePath);

  // 5. Verificar que está dentro do baseDir
  const resolvedBase = path.resolve(baseDir, 'tenants');
  if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path traversal detectado');
  }

  return resolvedPath;
}

// Exemplos:
// resolveTenantDataDir('/var/lib/libervia', 'acme-corp')
//   → '/var/lib/libervia/tenants/acme-corp'
//
// resolveTenantDataDir('/var/lib/libervia', '../etc/passwd')
//   → ERRO: TenantId inválido
//
// resolveTenantDataDir('/var/lib/libervia', 'acme-corp/../other')
//   → ERRO: TenantId inválido (contém /)
```

### 3.4 Garantia "Nenhum Arquivo Cruza Tenants"

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         BARREIRAS DE ISOLAMENTO                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   BARREIRA 1: TenantId Validation                                               │
│   ───────────────────────────────                                               │
│   • Regex restritivo (sem / \ .. etc)                                           │
│   • Lista de IDs reservados                                                     │
│   • Normalização lowercase                                                      │
│                                                                                 │
│   BARREIRA 2: Path Resolution                                                   │
│   ─────────────────────────────                                                 │
│   • path.resolve() para canonizar                                               │
│   • Verificação startsWith(baseDir)                                             │
│   • Sem seguir symlinks (fs.realpath se paranoid)                               │
│                                                                                 │
│   BARREIRA 3: Instância Isolada                                                 │
│   ─────────────────────────────                                                 │
│   • Cada tenant tem seus próprios repos                                         │
│   • Repos recebem dataDir no create()                                           │
│   • Repos NUNCA acessam fora do seu dataDir                                     │
│                                                                                 │
│   BARREIRA 4: Processo Isolado (Opção A)                                        │
│   ──────────────────────────────────────                                        │
│   • Cada processo só conhece seu dataDir                                        │
│   • Filesystem namespace (containers)                                           │
│   • Sem variáveis globais compartilhadas                                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Ajustes Mínimos na Camada 3 (Core)

### 4.1 Avaliação

Após análise detalhada do código atual:

```
╔═════════════════════════════════════════════════════════════════════════════════╗
║                                                                                 ║
║                    ZERO MUDANÇAS NECESSÁRIAS NO CORE                            ║
║                                                                                 ║
╚═════════════════════════════════════════════════════════════════════════════════╝
```

### 4.2 Por Que Zero Mudanças?

| Aspecto | Estado Atual | Implicação |
|---------|--------------|------------|
| **Repositórios** | Recebem `dataDir` no `create()` | Já são tenant-ready |
| **EventLog** | Recebe `dataDir` no `create()` | Já é tenant-ready |
| **Orquestrador** | Recebe repositórios já instanciados | Não sabe de tenants |
| **Entidades** | Sem conceito de tenant | Correto — não deve ter |
| **Serviços** | Recebem repositórios | Já são tenant-ready |
| **Adapter** | Recebe orquestrador instanciado | Não sabe de tenants |

### 4.3 Demonstração: Core já é Tenant-Ready

```typescript
// HOJE: Como criar um Core para um tenant (sem mudanças)
async function createCoreForTenant(tenantDataDir: string) {
  // 1. Criar repositórios apontando para o dataDir do tenant
  const situacaoRepo = await SituacaoRepositoryImpl.create(tenantDataDir);
  const episodioRepo = await EpisodioRepositoryImpl.create(tenantDataDir);
  const decisaoRepo = await DecisaoRepositoryImpl.create(tenantDataDir);
  const contratoRepo = await ContratoRepositoryImpl.create(tenantDataDir);
  const protocoloRepo = await DecisionProtocolRepositoryImpl.create(tenantDataDir);
  const eventLog = await EventLogRepositoryImpl.create(tenantDataDir);

  // 2. Criar serviço de memória
  const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

  // 3. Criar orquestrador
  const orquestrador = new OrquestradorCognitivo(
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    memoryService,
    protocoloRepo,
    eventLog
  );

  // 4. Inicializar
  await orquestrador.init();

  return { orquestrador, eventLog, /* repos... */ };
}

// Tenant ACME
const acmeCore = await createCoreForTenant('/var/lib/libervia/tenants/acme-corp');

// Tenant Globex
const globexCore = await createCoreForTenant('/var/lib/libervia/tenants/globex-inc');

// COMPLETAMENTE ISOLADOS — sem mudança no Core
```

### 4.4 O Que NÃO Fazer (e por quê)

| Anti-Pattern | Por Que Não Fazer |
|--------------|-------------------|
| Adicionar `tenantId` ao EventLogEntry | Viola "Core agnóstico a tenant" |
| Adicionar `tenantId` às entidades | Acopla domínio a infraestrutura |
| Criar `if (tenant === 'X')` no Core | Viola "lógica uniforme" |
| Passar tenantId para repositórios | Eles já recebem dataDir, suficiente |
| Singleton global de tenants | Viola isolamento |

### 4.5 Melhorias Opcionais (Fora do Core)

Se quisermos **facilitar** a criação de instâncias, podemos criar uma **factory utilitária** (FORA do Core):

```typescript
// tenant/CoreFactory.ts (NOVA CAMADA, não Core)
export class CoreFactory {
  static async create(dataDir: string, config?: CoreConfig): Promise<CoreInstance> {
    // Encapsula a criação de todos os repos + orquestrador + init()
    // Retorna um objeto com tudo pronto
  }
}
```

Isso é **Camada 6**, não Camada 3.

---

## 5. Camada 6: Design Concreto

### 5.1 Estrutura de Módulos

```
incremento-1/
└── tenant/                              # NOVA PASTA — Camada 6
    ├── TenantRegistry.ts                # Cadastro de tenants
    ├── TenantRuntime.ts                 # Instâncias ativas
    ├── TenantRouter.ts                  # Resolve tenant → runtime
    ├── TenantConfig.ts                  # Tipos de configuração
    ├── TenantSecurity.ts                # Validação, path safety
    ├── TenantQuotas.ts                  # Limites e quotas
    ├── TenantAdminAPI.ts                # API administrativa
    └── index.ts                         # Exports públicos
```

### 5.2 TenantRegistry

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              TENANT REGISTRY                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  RESPONSABILIDADES:                                                             │
│  • Armazenar configurações de todos os tenants                                  │
│  • Persistir em config/tenants.json                                             │
│  • Validar unicidade de tenantId                                                │
│  • Gerenciar status (active, suspended, deleted)                                │
│                                                                                 │
│  INTERFACE:                                                                     │
│  ──────────                                                                     │
│  interface TenantConfig {                                                       │
│    id: string;                        // ex: "acme-corp"                        │
│    name: string;                      // ex: "ACME Corporation"                 │
│    status: 'active' | 'suspended' | 'deleted';                                  │
│    createdAt: string;                 // ISO timestamp                          │
│    quotas: {                                                                    │
│      maxEvents: number;               // Máximo eventos no EventLog             │
│      maxStorageMB: number;            // Espaço em disco                        │
│      rateLimit: number;               // Requests/min                           │
│    };                                                                           │
│    features: {                                                                  │
│      backupEnabled: boolean;                                                    │
│      signedBackup: boolean;                                                     │
│    };                                                                           │
│  }                                                                              │
│                                                                                 │
│  MÉTODOS:                                                                       │
│  ─────────                                                                      │
│  • register(config: TenantConfig): Promise<void>                                │
│  • get(tenantId: string): TenantConfig | null                                   │
│  • update(tenantId: string, partial: Partial<TenantConfig>): Promise<void>      │
│  • suspend(tenantId: string): Promise<void>                                     │
│  • delete(tenantId: string): Promise<void>   // Soft delete                     │
│  • list(): TenantConfig[]                                                       │
│  • listActive(): TenantConfig[]                                                 │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 TenantRuntime

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              TENANT RUNTIME                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  RESPONSABILIDADES:                                                             │
│  • Gerenciar instâncias ativas do Core por tenant                               │
│  • Lazy loading (cria instância sob demanda)                                    │
│  • Lifecycle (init, shutdown, health check)                                     │
│  • Cache de instâncias ativas                                                   │
│                                                                                 │
│  INTERFACE:                                                                     │
│  ──────────                                                                     │
│  interface CoreInstance {                                                       │
│    tenantId: string;                                                            │
│    orquestrador: OrquestradorCognitivo;                                         │
│    eventLog: EventLogRepository;                                                │
│    adapter?: BazariAdapter;           // Opcional                               │
│    startedAt: string;                                                           │
│    lastActivity: string;                                                        │
│  }                                                                              │
│                                                                                 │
│  MÉTODOS:                                                                       │
│  ─────────                                                                      │
│  • getOrCreate(tenantId: string): Promise<CoreInstance>                         │
│  • get(tenantId: string): CoreInstance | null                                   │
│  • shutdown(tenantId: string): Promise<void>                                    │
│  • shutdownAll(): Promise<void>                                                 │
│  • isActive(tenantId: string): boolean                                          │
│  • getMetrics(tenantId: string): RuntimeMetrics                                 │
│                                                                                 │
│  DIAGRAMA INTERNO:                                                              │
│  ─────────────────                                                              │
│                                                                                 │
│   ┌─────────────────────────────────────────────────────────────────┐           │
│   │                     TenantRuntime                               │           │
│   │                                                                 │           │
│   │   instances: Map<tenantId, CoreInstance>                        │           │
│   │                                                                 │           │
│   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │           │
│   │   │ acme-corp   │  │ globex-inc  │  │ initech-llc │             │           │
│   │   │             │  │             │  │             │             │           │
│   │   │ Core + Orq  │  │ Core + Orq  │  │ Core + Orq  │             │           │
│   │   │ EventLog    │  │ EventLog    │  │ EventLog    │             │           │
│   │   │ Repos       │  │ Repos       │  │ Repos       │             │           │
│   │   └─────────────┘  └─────────────┘  └─────────────┘             │           │
│   │                                                                 │           │
│   └─────────────────────────────────────────────────────────────────┘           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.4 TenantRouter

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              TENANT ROUTER                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  RESPONSABILIDADES:                                                             │
│  • Resolver tenantId a partir da requisição (header, path, token)               │
│  • Validar que tenant existe e está ativo                                       │
│  • Retornar instância do Core para o tenant                                     │
│  • Aplicar rate limiting por tenant                                             │
│                                                                                 │
│  MÉTODOS:                                                                       │
│  ─────────                                                                      │
│  • resolve(req: Request): Promise<CoreInstance>                                 │
│  • extractTenantId(req: Request): string | null                                 │
│  • validateAccess(tenantId: string): AccessResult                               │
│                                                                                 │
│  ESTRATÉGIAS DE EXTRAÇÃO:                                                       │
│  ────────────────────────                                                       │
│                                                                                 │
│   1. HEADER (Recomendado)                                                       │
│      X-Tenant-Id: acme-corp                                                     │
│                                                                                 │
│   2. PATH PREFIX                                                                │
│      /api/v1/tenants/{tenantId}/solicitacoes                                    │
│                                                                                 │
│   3. SUBDOMAIN                                                                  │
│      acme-corp.libervia.io/api/v1/solicitacoes                                  │
│                                                                                 │
│   4. JWT CLAIM (Produção)                                                       │
│      { "sub": "user-123", "tenant": "acme-corp", ... }                          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.5 TenantAdminAPI

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            TENANT ADMIN API                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ENDPOINTS:                                                                     │
│  ──────────                                                                     │
│                                                                                 │
│  GESTÃO DE TENANTS                                                              │
│  POST   /admin/tenants                    Criar tenant                          │
│  GET    /admin/tenants                    Listar tenants                        │
│  GET    /admin/tenants/{id}               Detalhes do tenant                    │
│  PATCH  /admin/tenants/{id}               Atualizar config                      │
│  POST   /admin/tenants/{id}/suspend       Suspender                             │
│  POST   /admin/tenants/{id}/resume        Reativar                              │
│  DELETE /admin/tenants/{id}               Deletar (soft)                        │
│                                                                                 │
│  AUDITORIA POR TENANT                                                           │
│  GET    /admin/tenants/{id}/eventlog      Listar eventos                        │
│  GET    /admin/tenants/{id}/eventlog/export?from=&to=   Export range            │
│  GET    /admin/tenants/{id}/eventlog/verify             Verificar chain         │
│  POST   /admin/tenants/{id}/eventlog/replay             Replay                  │
│                                                                                 │
│  BACKUP POR TENANT                                                              │
│  POST   /admin/tenants/{id}/backup        Criar backup                          │
│  GET    /admin/tenants/{id}/backups       Listar backups                        │
│  POST   /admin/tenants/{id}/restore       Restaurar backup                      │
│                                                                                 │
│  MÉTRICAS                                                                       │
│  GET    /admin/tenants/{id}/metrics       Métricas do tenant                    │
│  GET    /admin/metrics                    Métricas globais                      │
│  GET    /admin/health                     Health check                          │
│                                                                                 │
│  AUTENTICAÇÃO:                                                                  │
│  ──────────────                                                                 │
│  • Endpoints /admin/* requerem token de admin (diferente de tenant token)       │
│  • Rate limit mais restritivo (10 req/min)                                      │
│  • Audit log de todas as operações admin                                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.6 TenantSecurity

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            TENANT SECURITY                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  VALIDAÇÕES:                                                                    │
│  ───────────                                                                    │
│  • validateTenantId(id: string): ValidationResult                               │
│  • resolveSafeDataDir(baseDir: string, tenantId: string): string                │
│  • checkQuotas(tenantId: string, operation: string): QuotaResult                │
│  • checkRateLimit(tenantId: string): RateLimitResult                            │
│                                                                                 │
│  REGRAS DE TENANTID:                                                            │
│  ───────────────────                                                            │
│  • Regex: /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/                                   │
│  • Reservados: admin, system, config, backup, logs, tenants                     │
│  • Normalização: lowercase, trim                                                │
│                                                                                 │
│  PREVENÇÃO DE PATH TRAVERSAL:                                                   │
│  ────────────────────────────                                                   │
│  • Rejeitar qualquer id com: / \ .. ~ $                                         │
│  • Usar path.resolve() + verificar startsWith(baseDir)                          │
│  • Não seguir symlinks (opcional: fs.realpath)                                  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Auditoria e Imutabilidade por Tenant

### 6.1 EventLog por Tenant

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EVENT LOG — ISOLAMENTO POR TENANT                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   COMO FUNCIONA HOJE (já suporta multi-tenant):                                 │
│   ─────────────────────────────────────────────                                 │
│                                                                                 │
│   // Tenant ACME                                                                │
│   const acmeEventLog = await EventLogRepositoryImpl.create(                     │
│     '/var/lib/libervia/tenants/acme-corp'                                       │
│   );                                                                            │
│   // Cria: /var/lib/libervia/tenants/acme-corp/event-log/segment-*.json         │
│                                                                                 │
│   // Tenant Globex                                                              │
│   const globexEventLog = await EventLogRepositoryImpl.create(                   │
│     '/var/lib/libervia/tenants/globex-inc'                                      │
│   );                                                                            │
│   // Cria: /var/lib/libervia/tenants/globex-inc/event-log/segment-*.json        │
│                                                                                 │
│   ISOLAMENTO GARANTIDO:                                                         │
│   • Cada EventLog opera em diretório separado                                   │
│   • Hash chain é independente por tenant                                        │
│   • Snapshot é independente por tenant                                          │
│   • Nenhum evento "vaza" entre tenants                                          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Export/Replay/Verify por Tenant

```typescript
// Camada 6 expõe operações de auditoria por tenant

class TenantAdminAPI {
  /**
   * Exportar eventos de um tenant em um range de tempo
   */
  async exportEventLog(
    tenantId: string,
    options: { from?: string; to?: string }
  ): Promise<EventLogEntry[]> {
    const instance = await this.runtime.getOrCreate(tenantId);
    return instance.eventLog.exportRange(options.from, options.to);
  }

  /**
   * Verificar integridade da cadeia de um tenant
   */
  async verifyChain(tenantId: string): Promise<ChainVerificationResult> {
    const instance = await this.runtime.getOrCreate(tenantId);
    return instance.eventLog.verifyChain();
  }

  /**
   * Replay do EventLog de um tenant
   */
  async replayEventLog(tenantId: string): Promise<ReplaySummary> {
    const instance = await this.runtime.getOrCreate(tenantId);
    return instance.eventLog.replayEventLog();
  }

  /**
   * Verificar a partir do snapshot (fast path)
   */
  async verifyFromSnapshot(tenantId: string): Promise<ChainVerificationResult> {
    const instance = await this.runtime.getOrCreate(tenantId);
    return instance.eventLog.verifyFromSnapshot();
  }
}
```

### 6.3 Ancoragem em Blockchain/Timestamping (Extensão Futura)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    ANCORAGEM EXTERNA — EXTENSÃO FUTURA                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  CONCEITO:                                                                      │
│  • Periodicamente, publicar hash do último evento em blockchain/TSA             │
│  • Permite prova de existência em momento específico                            │
│  • Não altera Core — é extensão na Camada 6                                     │
│                                                                                 │
│  IMPLEMENTAÇÃO SUGERIDA:                                                        │
│  ────────────────────────                                                       │
│                                                                                 │
│   ┌───────────────────────────────────────────────────────────────────┐         │
│   │                      TenantAnchoring                              │         │
│   │                                                                   │         │
│   │  • scheduleAnchor(tenantId: string, interval: string)             │         │
│   │  • anchorNow(tenantId: string): Promise<AnchorReceipt>            │         │
│   │  • verifyAnchor(tenantId: string, receipt: AnchorReceipt)         │         │
│   │                                                                   │         │
│   │  PROVEDORES SUPORTADOS:                                           │         │
│   │  • Ethereum (hash em tx data)                                     │         │
│   │  • Bitcoin (OP_RETURN)                                            │         │
│   │  • RFC 3161 TSA (Timestamp Authority)                             │         │
│   │  • OpenTimestamps                                                 │         │
│   └───────────────────────────────────────────────────────────────────┘         │
│                                                                                 │
│  DADOS ANCORADOS (por evento de ancoragem):                                     │
│  ──────────────────────────────────────────                                     │
│  {                                                                              │
│    tenantId: "acme-corp",                                                       │
│    anchoredAt: "2025-12-23T10:00:00Z",                                          │
│    eventLogHash: "sha256(último current_hash)",                                 │
│    totalEvents: 150000,                                                         │
│    snapshotHash: "sha256(snapshot)",                                            │
│    proofType: "ethereum",                                                       │
│    txHash: "0x...",                                                             │
│    blockNumber: 12345678                                                        │
│  }                                                                              │
│                                                                                 │
│  IMPACTO NO CORE: ZERO                                                          │
│  • Ancoragem apenas lê current_hash do EventLog                                 │
│  • Não modifica eventos                                                         │
│  • É hook externo, não acoplamento                                              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Impacto nos Testes e Incrementos Atuais

### 7.1 Testes do Core (Não Afetados)

```
╔═════════════════════════════════════════════════════════════════════════════════╗
║                                                                                 ║
║         TESTES DO CORE CONTINUAM PASSANDO SEM ALTERAÇÃO                         ║
║                                                                                 ║
╚═════════════════════════════════════════════════════════════════════════════════╝

RAZÃO: O Core não é modificado. A Camada 6 é adição, não alteração.

Testes existentes:
✓ incremento1.test.ts  — Imutabilidade, append-only, persistência
✓ incremento2.test.ts  — Índices, find() otimizado
✓ incremento3.test.ts  — DecisionProtocol obrigatório
✓ incremento4.test.ts  — EventLog com hash encadeado
✓ incremento4_1.test.ts — Production safety
✓ incremento4_2.test.ts — Segmentação, snapshot, retenção
✓ incremento4_3.test.ts — Export, replay, verifyFromSnapshot
✓ incremento5.test.ts  — Memória institucional
✓ incremento6.test.ts  — Control plane
✓ incremento7.test.ts  — Adapter Bazari
✓ incremento8.test.ts  — Load test, drill
✓ incremento9.test.ts  — Backup seguro, auth

NENHUM DESSES TESTES PRECISA SER ALTERADO.
```

### 7.2 Novos Testes Necessários (Camada 6)

```
NOVOS TESTES PARA CAMADA 6:
────────────────────────────

incremento-1/testes/tenant/
├── tenantRegistry.test.ts       # Registro e lifecycle de tenants
├── tenantRuntime.test.ts        # Criação e shutdown de instâncias
├── tenantRouter.test.ts         # Resolução de tenantId
├── tenantSecurity.test.ts       # Validação, path traversal
├── tenantQuotas.test.ts         # Limites e rate limiting
├── tenantAdminAPI.test.ts       # Endpoints administrativos
└── tenantIsolation.test.ts      # Testes de isolamento (CRÍTICO)

TESTES DE ISOLAMENTO (tenantIsolation.test.ts):
───────────────────────────────────────────────
• Tenant A não consegue ler dados de Tenant B
• Path traversal é bloqueado
• TenantId malicioso é rejeitado
• Crash de um tenant não afeta outro (se multi-processo)
• Rate limit de um tenant não afeta outro
```

### 7.3 O Que NÃO Deve Ser Alterado

| Categoria | Arquivos | Razão |
|-----------|----------|-------|
| Core | `orquestrador/*.ts` | Agnóstico a tenant |
| Core | `repositorios/**/*.ts` | Já recebem dataDir |
| Core | `entidades/*.ts` | Sem conceito de tenant |
| Core | `servicos/*.ts` | Agnóstico a tenant |
| Core | `event-log/*.ts` | Já recebe dataDir |
| Testes Core | `testes/incremento*.test.ts` | Validam comportamento Core |

---

## 8. Entrega: Resumo e Próximos Passos

### 8.1 Decisão Recomendada (Produção Inicial)

```
╔═════════════════════════════════════════════════════════════════════════════════╗
║                                                                                 ║
║  RECOMENDAÇÃO PARA GO-LIVE MULTI-TENANT                                         ║
║                                                                                 ║
║  1. TOPOLOGIA: Instância isolada por tenant (processo separado)                 ║
║                                                                                 ║
║  2. ORQUESTRAÇÃO: Docker Compose ou Kubernetes                                  ║
║                                                                                 ║
║  3. CAMADA 6: Implementar TenantRegistry + AdminAPI mínimos                     ║
║                                                                                 ║
║  4. CORE: ZERO MUDANÇAS                                                         ║
║                                                                                 ║
╚═════════════════════════════════════════════════════════════════════════════════╝
```

### 8.2 Riscos e Mitigação

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Path traversal por tenantId malicioso | Média | Alto | Validação rigorosa + regex restritivo |
| Tenant consome todo o disco | Média | Alto | Quotas de storage + alertas |
| Tenant DDoS interno | Baixa | Médio | Rate limiting por tenant |
| Confusão de dados em debug | Média | Baixo | Logs com prefixo [tenantId] |
| Backup de tenant errado | Baixa | Alto | Validação dupla de tenantId |

### 8.3 Lista de Mudanças Mínimas

#### Core (Camada 3)
```
ZERO MUDANÇAS
```

#### Fora do Core (Novas adições)

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `tenant/TenantRegistry.ts` | Novo | Cadastro de tenants |
| `tenant/TenantRuntime.ts` | Novo | Gestão de instâncias |
| `tenant/TenantRouter.ts` | Novo | Resolução tenantId → instância |
| `tenant/TenantConfig.ts` | Novo | Tipos de configuração |
| `tenant/TenantSecurity.ts` | Novo | Validação e segurança |
| `tenant/TenantQuotas.ts` | Novo | Limites e quotas |
| `tenant/TenantAdminAPI.ts` | Novo | API administrativa |
| `tenant/index.ts` | Novo | Exports públicos |
| `testes/tenant/*.test.ts` | Novo | Testes da Camada 6 |
| `docs/arquitetura/camada6_*.md` | Novo | Documentação |

### 8.4 Próximos Incrementos Sugeridos (Ordem Ideal)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         ROADMAP PÓS CAMADA 6                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  INCREMENTO 11: Multi-Tenant Foundation                                         │
│  ────────────────────────────────────────                                       │
│  • TenantRegistry + TenantSecurity                                              │
│  • Validação de tenantId + path safety                                          │
│  • Estrutura de diretórios por tenant                                           │
│  • Testes de isolamento                                                         │
│                                                                                 │
│  INCREMENTO 12: Tenant Runtime                                                  │
│  ────────────────────────────────                                               │
│  • TenantRuntime (lazy loading de instâncias)                                   │
│  • TenantRouter (resolução por header/path)                                     │
│  • Lifecycle (init, shutdown, health)                                           │
│                                                                                 │
│  INCREMENTO 13: Admin API                                                       │
│  ────────────────────────────                                                   │
│  • CRUD de tenants                                                              │
│  • Export/verify/replay por tenant                                              │
│  • Backup por tenant                                                            │
│  • Métricas por tenant                                                          │
│                                                                                 │
│  INCREMENTO 14: Quotas e Rate Limiting                                          │
│  ────────────────────────────────────────                                       │
│  • Limites de eventos, storage, requests                                        │
│  • Rate limiting por tenant                                                     │
│  • Alertas de quota                                                             │
│                                                                                 │
│  INCREMENTO 15: Multi-Tenant em Produção                                        │
│  ────────────────────────────────────────                                       │
│  • Docker Compose multi-tenant                                                  │
│  • Kubernetes manifests                                                         │
│  • Observabilidade (logs, métricas, traces)                                     │
│                                                                                 │
│  INCREMENTO 16: Ancoragem Externa (Opcional)                                    │
│  ────────────────────────────────────────────                                   │
│  • Integração com blockchain/TSA                                                │
│  • Prova de existência                                                          │
│  • Verificação de âncoras                                                       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Apêndice A: Checklist de Implementação

```
INCREMENTO 11 — CHECKLIST
─────────────────────────

[ ] Criar pasta tenant/
[ ] Implementar TenantConfig.ts (tipos)
[ ] Implementar TenantSecurity.ts
    [ ] validateTenantId()
    [ ] resolveSafeDataDir()
    [ ] RESERVED_IDS
[ ] Implementar TenantRegistry.ts
    [ ] register()
    [ ] get()
    [ ] list()
    [ ] suspend()
    [ ] Persistência em config/tenants.json
[ ] Testes
    [ ] tenantSecurity.test.ts (path traversal, IDs maliciosos)
    [ ] tenantRegistry.test.ts (CRUD básico)
    [ ] tenantIsolation.test.ts (dados não vazam)
[ ] Documentação
    [ ] Atualizar camada6_diagrama.md
    [ ] Runbook de operação multi-tenant
```

---

*Documento gerado em: 2025-12-23*
*Versão: 1.0 — Análise e Projeto (sem implementação)*
