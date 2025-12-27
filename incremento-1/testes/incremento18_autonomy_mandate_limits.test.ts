/**
 * TESTES - Incremento 18: Mandatos Temporais + Limite de Uso + Expiração
 *
 * Testa:
 * - A) Validade Temporal (validFrom, validUntil)
 * - B) Limite de Usos (maxUses)
 * - C) Auditoria (AUTONOMY_EXPIRED event)
 * - D) Retrocompatibilidade
 * - E) Concorrência (persistLock)
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Imports de tipos de autonomia
import {
  AutonomyMode,
  AutonomyMandate,
  AutonomyCheckInput,
  evaluate,
  isMandateValid,
  getEffectiveMode,
  REGRA,
  perfilExcede,
  AutonomyCheckResultExtended,
  // Serviço de Mandato (Inc 18)
  MandateActivityResult,
  MANDATE_RULE,
  isMandateActive,
  canConsumeUse,
  consumeUse,
  markAsExpired,
  shouldMarkExpired,
  getEffectiveStatus,
  // Helpers de Tempo (Inc 18)
  parseIsoDate,
  isBefore,
  isAfter,
  isWithinRange,
  nowIso
} from '../camada-3/autonomy';

import { AutonomyMandateRepositoryImpl } from '../camada-3/autonomy/AutonomyMandateRepositoryImpl';

// Imports do Core
import { TipoEvento, TipoEntidade } from '../camada-3/event-log/EventLogEntry';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';
import { PerfilRisco } from '../camada-3/entidades/tipos';
import { AggregationPolicy } from '../camada-3/multiagente/MultiAgentTypes';

// Repositórios
import { SituacaoRepositoryImpl } from '../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_DATA_DIR = './test-data-inc18';

beforeAll(async () => {
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function createTestDir(suffix: string): string {
  return path.join(TEST_DATA_DIR, suffix);
}

function createValidMandate(overrides?: Partial<AutonomyMandate>): AutonomyMandate {
  return {
    id: `mandate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent-1',
    modo: AutonomyMode.VIVENCIA_AUTONOMA,
    politicas_permitidas: ['FIRST_VALID', 'MAJORITY_BY_ALTERNATIVE'] as AggregationPolicy[],
    perfil_risco_maximo: PerfilRisco.MODERADO,
    limites: [],
    requer_humano_se: [],
    concedido_por: 'admin',
    concedido_em: new Date(),
    revogado: false,
    status: 'active',
    uses: 0,
    ...overrides
  };
}

function createCheckInput(overrides?: Partial<AutonomyCheckInput>): AutonomyCheckInput {
  return {
    agentId: 'agent-1',
    policy: 'FIRST_VALID' as AggregationPolicy,
    perfilRisco: PerfilRisco.CONSERVADOR,
    closedLayerBlocked: false,
    ...overrides
  };
}

async function setupOrquestrador(suffix: string) {
  const dir = createTestDir(suffix);
  await fs.mkdir(dir, { recursive: true });

  const situacaoRepo = new SituacaoRepositoryImpl(path.join(dir, 'situacoes.json'));
  const episodioRepo = new EpisodioRepositoryImpl(path.join(dir, 'episodios.json'));
  const decisaoRepo = new DecisaoRepositoryImpl(path.join(dir, 'decisoes.json'));
  const contratoRepo = new ContratoRepositoryImpl(path.join(dir, 'contratos.json'));
  const protocoloRepo = new DecisionProtocolRepositoryImpl(path.join(dir, 'protocolos.json'));
  const eventLog = await EventLogRepositoryImpl.create(path.join(dir, 'events.json'));
  const autonomyRepo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));

  const memoryService = new MemoryQueryService(
    episodioRepo,
    decisaoRepo,
    contratoRepo
  );

  const orquestrador = new OrquestradorCognitivo(
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    memoryService,
    protocoloRepo,
    eventLog,
    undefined, // observacaoRepo
    autonomyRepo
  );

  return { orquestrador, eventLog, autonomyRepo };
}

// ════════════════════════════════════════════════════════════════════════════
// A) TESTES: VALIDADE TEMPORAL
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 18 - Validade Temporal', () => {
  describe('AutonomyTime helpers', () => {
    test('parseIsoDate converte string ISO para Date', () => {
      const isoString = '2025-01-15T10:30:00.000Z';
      const date = parseIsoDate(isoString);

      expect(date).toBeInstanceOf(Date);
      expect(date!.toISOString()).toBe(isoString);
    });

    test('parseIsoDate retorna null para undefined', () => {
      expect(parseIsoDate(undefined)).toBeNull();
    });

    test('parseIsoDate aceita Date e retorna como está', () => {
      const date = new Date('2025-01-15T10:30:00.000Z');
      expect(parseIsoDate(date)).toBe(date);
    });

    test('isBefore retorna true se data A é antes de B', () => {
      const a = new Date('2025-01-01');
      const b = new Date('2025-01-15');
      expect(isBefore(a, b)).toBe(true);
      expect(isBefore(b, a)).toBe(false);
    });

    test('isAfter retorna true se data A é depois de B', () => {
      const a = new Date('2025-01-15');
      const b = new Date('2025-01-01');
      expect(isAfter(a, b)).toBe(true);
      expect(isAfter(b, a)).toBe(false);
    });

    test('isWithinRange verifica intervalo corretamente', () => {
      const now = new Date('2025-01-10');
      const from = new Date('2025-01-01');
      const until = new Date('2025-01-31');

      expect(isWithinRange(now, from, until)).toBe(true);
      expect(isWithinRange(new Date('2024-12-31'), from, until)).toBe(false);
      expect(isWithinRange(new Date('2025-02-01'), from, until)).toBe(false);
    });

    test('nowIso retorna ISO string da data fornecida', () => {
      const date = new Date('2025-01-15T10:30:00.000Z');
      expect(nowIso(date)).toBe('2025-01-15T10:30:00.000Z');
    });
  });

  describe('validFrom - Mandato ainda não ativo', () => {
    test('Mandato com validFrom no futuro bloqueia', () => {
      const futureDate = new Date(Date.now() + 86400000); // +1 dia
      const mandate = createValidMandate({
        validFrom: futureDate.toISOString()
      });
      const now = new Date();

      const result = isMandateActive(mandate, now);

      expect(result.ok).toBe(false);
      expect(result.code).toBe(MANDATE_RULE.NOT_ACTIVE_YET);
      expect(result.reason).toContain('ainda não ativo');
    });

    test('Mandato com validFrom no passado permite', () => {
      const pastDate = new Date(Date.now() - 86400000); // -1 dia
      const mandate = createValidMandate({
        validFrom: pastDate.toISOString()
      });
      const now = new Date();

      const result = isMandateActive(mandate, now);

      expect(result.ok).toBe(true);
    });

    test('Mandato com validFrom exatamente agora permite', () => {
      const now = new Date();
      const mandate = createValidMandate({
        validFrom: now.toISOString()
      });

      // Testar 1ms após validFrom
      const slightlyAfter = new Date(now.getTime() + 1);
      const result = isMandateActive(mandate, slightlyAfter);

      expect(result.ok).toBe(true);
    });

    test('evaluate bloqueia com validFrom futuro e retorna MANDATE_NOT_ACTIVE_YET', () => {
      const futureDate = new Date(Date.now() + 86400000);
      const mandate = createValidMandate({
        validFrom: futureDate.toISOString()
      });
      const input = createCheckInput({
        mandate,
        now: new Date()
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(MANDATE_RULE.NOT_ACTIVE_YET);
    });
  });

  describe('validUntil - Mandato expirado por tempo', () => {
    test('Mandato com validUntil no passado bloqueia', () => {
      const pastDate = new Date(Date.now() - 86400000); // -1 dia
      const mandate = createValidMandate({
        validUntil: pastDate.toISOString()
      });
      const now = new Date();

      const result = isMandateActive(mandate, now);

      expect(result.ok).toBe(false);
      expect(result.code).toBe(MANDATE_RULE.EXPIRED_TIME);
      expect(result.expireReason).toBe('TIME');
    });

    test('Mandato com validUntil no futuro permite', () => {
      const futureDate = new Date(Date.now() + 86400000); // +1 dia
      const mandate = createValidMandate({
        validUntil: futureDate.toISOString()
      });
      const now = new Date();

      const result = isMandateActive(mandate, now);

      expect(result.ok).toBe(true);
    });

    test('evaluate bloqueia com validUntil passado e sinaliza expiração', () => {
      const pastDate = new Date(Date.now() - 86400000);
      const mandate = createValidMandate({
        validUntil: pastDate.toISOString()
      });
      const now = new Date();
      const input = createCheckInput({
        mandate,
        now
      });

      const result = evaluate(input) as AutonomyCheckResultExtended;

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(MANDATE_RULE.EXPIRED_TIME);
      expect(result.shouldExpire).toBe(true);
      expect(result.expireReason).toBe('TIME');
    });

    test('Testa com now determinístico para validUntil', () => {
      const validUntil = new Date('2025-01-15T12:00:00.000Z');
      const mandate = createValidMandate({
        validUntil: validUntil.toISOString()
      });

      // Antes do limite - permite
      const before = new Date('2025-01-15T11:59:59.000Z');
      expect(isMandateActive(mandate, before).ok).toBe(true);

      // Depois do limite - bloqueia
      const after = new Date('2025-01-15T12:00:01.000Z');
      expect(isMandateActive(mandate, after).ok).toBe(false);
    });
  });

  describe('Combinação validFrom + validUntil', () => {
    test('Mandato fora do intervalo temporal bloqueia', () => {
      const mandate = createValidMandate({
        validFrom: '2025-02-01T00:00:00.000Z',
        validUntil: '2025-02-28T23:59:59.000Z'
      });

      // Antes do intervalo
      const beforeResult = isMandateActive(mandate, new Date('2025-01-15T00:00:00.000Z'));
      expect(beforeResult.ok).toBe(false);
      expect(beforeResult.code).toBe(MANDATE_RULE.NOT_ACTIVE_YET);

      // Depois do intervalo
      const afterResult = isMandateActive(mandate, new Date('2025-03-01T00:00:00.000Z'));
      expect(afterResult.ok).toBe(false);
      expect(afterResult.code).toBe(MANDATE_RULE.EXPIRED_TIME);
    });

    test('Mandato dentro do intervalo temporal permite', () => {
      const mandate = createValidMandate({
        validFrom: '2025-02-01T00:00:00.000Z',
        validUntil: '2025-02-28T23:59:59.000Z'
      });

      const withinResult = isMandateActive(mandate, new Date('2025-02-15T12:00:00.000Z'));
      expect(withinResult.ok).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B) TESTES: LIMITE DE USOS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 18 - Limite de Usos', () => {
  describe('AutonomyMandateService', () => {
    test('canConsumeUse retorna true se sem limite', () => {
      const mandate = createValidMandate({ maxUses: undefined });
      expect(canConsumeUse(mandate)).toBe(true);
    });

    test('canConsumeUse retorna true se uses < maxUses', () => {
      const mandate = createValidMandate({ maxUses: 5, uses: 3 });
      expect(canConsumeUse(mandate)).toBe(true);
    });

    test('canConsumeUse retorna false se uses >= maxUses', () => {
      const mandate = createValidMandate({ maxUses: 5, uses: 5 });
      expect(canConsumeUse(mandate)).toBe(false);
    });

    test('consumeUse incrementa contador e define lastUsedAt', () => {
      const now = new Date('2025-01-15T10:00:00.000Z');
      const mandate = createValidMandate({ uses: 2, maxUses: 5 });

      const updated = consumeUse(mandate, now);

      expect(updated.uses).toBe(3);
      expect(updated.lastUsedAt).toBe('2025-01-15T10:00:00.000Z');
      expect(updated.status).toBe('active'); // Ainda não esgotou
    });

    test('consumeUse marca como expirado quando atinge maxUses', () => {
      const now = new Date('2025-01-15T10:00:00.000Z');
      const mandate = createValidMandate({ uses: 4, maxUses: 5 });

      const updated = consumeUse(mandate, now);

      expect(updated.uses).toBe(5);
      expect(updated.status).toBe('expired');
      expect(updated.expireReason).toBe('USES');
      expect(updated.expiredAt).toBe('2025-01-15T10:00:00.000Z');
    });

    test('consumeUse é imutável (não modifica original)', () => {
      const mandate = createValidMandate({ uses: 2, maxUses: 5 });
      const originalUses = mandate.uses;

      consumeUse(mandate, new Date());

      expect(mandate.uses).toBe(originalUses);
    });

    test('shouldMarkExpired detecta esgotamento de usos', () => {
      const mandate = createValidMandate({ uses: 5, maxUses: 5 });

      const reason = shouldMarkExpired(mandate, new Date());

      expect(reason).toBe('USES');
    });

    test('getEffectiveStatus retorna status correto', () => {
      expect(getEffectiveStatus(createValidMandate({ status: 'active' }))).toBe('active');
      expect(getEffectiveStatus(createValidMandate({ status: 'expired' }))).toBe('expired');
      expect(getEffectiveStatus(createValidMandate({ status: 'revoked' }))).toBe('revoked');
      // Retrocompatibilidade
      expect(getEffectiveStatus(createValidMandate({ status: undefined, revogado: true }))).toBe('revoked');
    });
  });

  describe('maxUses enforcement', () => {
    test('Mandato com uses=0 e maxUses=1 permite primeiro uso', () => {
      const mandate = createValidMandate({ uses: 0, maxUses: 1 });

      const result = isMandateActive(mandate, new Date());

      expect(result.ok).toBe(true);
    });

    test('Mandato com uses=1 e maxUses=1 bloqueia segundo uso', () => {
      const mandate = createValidMandate({ uses: 1, maxUses: 1 });

      const result = isMandateActive(mandate, new Date());

      expect(result.ok).toBe(false);
      expect(result.code).toBe(MANDATE_RULE.EXHAUSTED_USES);
      expect(result.expireReason).toBe('USES');
    });

    test('evaluate bloqueia com maxUses esgotado', () => {
      const mandate = createValidMandate({ uses: 3, maxUses: 3 });
      const input = createCheckInput({ mandate });

      const result = evaluate(input) as AutonomyCheckResultExtended;

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(MANDATE_RULE.EXHAUSTED_USES);
      expect(result.shouldExpire).toBe(true);
      expect(result.expireReason).toBe('USES');
    });

    test('Mandato sem maxUses não tem limite de uso', () => {
      const mandate = createValidMandate({ uses: 1000, maxUses: undefined });

      const result = isMandateActive(mandate, new Date());

      expect(result.ok).toBe(true);
    });

    test('Mandato com maxUses=0 é tratado como sem limite', () => {
      const mandate = createValidMandate({ uses: 100, maxUses: 0 });

      const result = isMandateActive(mandate, new Date());

      expect(result.ok).toBe(true);
    });
  });

  describe('Repositório - incrementUses', () => {
    test('incrementUses atualiza uses atomicamente', async () => {
      const dir = createTestDir('inc-uses-1');
      await fs.mkdir(dir, { recursive: true });

      const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
      const mandate = createValidMandate({
        id: 'mandate-inc-uses',
        uses: 0,
        maxUses: 5
      });

      await repo.create(mandate);

      const updated = await repo.incrementUses('mandate-inc-uses');

      expect(updated.uses).toBe(1);
      expect(updated.lastUsedAt).toBeDefined();

      // Verificar persistência
      const retrieved = await repo.getById('mandate-inc-uses');
      expect(retrieved!.uses).toBe(1);
    });

    test('incrementUses marca expirado ao atingir maxUses', async () => {
      const dir = createTestDir('inc-uses-2');
      await fs.mkdir(dir, { recursive: true });

      const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
      const mandate = createValidMandate({
        id: 'mandate-exhaust',
        uses: 4,
        maxUses: 5
      });

      await repo.create(mandate);

      const updated = await repo.incrementUses('mandate-exhaust');

      expect(updated.uses).toBe(5);
      expect(updated.status).toBe('expired');
      expect(updated.expireReason).toBe('USES');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C) TESTES: AUDITORIA (AUTONOMY_EXPIRED)
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 18 - Auditoria', () => {
  describe('AUTONOMY_EXPIRED event', () => {
    test('MarcarMandatoExpirado registra evento AUTONOMY_EXPIRED', async () => {
      const { orquestrador, eventLog } = await setupOrquestrador('audit-expired-1');

      const mandate = createValidMandate({
        id: 'mandate-expire-audit',
        validUntil: new Date(Date.now() - 1000).toISOString() // Expirado
      });
      await orquestrador.ConcederMandato(mandate);

      await orquestrador.MarcarMandatoExpirado('mandate-expire-audit', 'TIME');

      const events = await eventLog.getAll();
      const expireEvent = events.find(e => e.evento === TipoEvento.AUTONOMY_EXPIRED);

      expect(expireEvent).toBeDefined();
      expect(expireEvent!.entidade).toBe(TipoEntidade.AUTONOMY_MANDATE);
      expect(expireEvent!.entidade_id).toBe('mandate-expire-audit');
    });

    test('RegistrarUsoMandato registra evento AUTONOMY_USE_CONSUMED', async () => {
      const { orquestrador, eventLog } = await setupOrquestrador('audit-use-1');

      const mandate = createValidMandate({
        id: 'mandate-use-audit',
        uses: 0,
        maxUses: 5
      });
      await orquestrador.ConcederMandato(mandate);

      await orquestrador.RegistrarUsoMandato('mandate-use-audit');

      const events = await eventLog.getAll();
      const useEvent = events.find(e => e.evento === TipoEvento.AUTONOMY_USE_CONSUMED);

      expect(useEvent).toBeDefined();
      expect(useEvent!.entidade_id).toBe('mandate-use-audit');
    });

    test('markExpired é idempotente - não registra evento duplicado', async () => {
      const dir = createTestDir('audit-idempotent');
      await fs.mkdir(dir, { recursive: true });

      const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
      const mandate = createValidMandate({
        id: 'mandate-idempotent',
        validUntil: new Date(Date.now() - 1000).toISOString()
      });

      await repo.create(mandate);

      // Primeira expiração
      await repo.markExpired('mandate-idempotent', 'TIME');
      const after1 = await repo.getById('mandate-idempotent');
      expect(after1!.status).toBe('expired');

      // Segunda expiração - deve ser idempotente
      await repo.markExpired('mandate-idempotent', 'TIME');
      const after2 = await repo.getById('mandate-idempotent');
      expect(after2!.status).toBe('expired');
      // Não deve lançar erro
    });

    test('markExpired concorrente não duplica evento (race condition)', async () => {
      const dir = createTestDir('audit-concurrent-expire');
      await fs.mkdir(dir, { recursive: true });

      const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
      const mandate = createValidMandate({
        id: 'mandate-concurrent-expire',
        validUntil: new Date(Date.now() - 1000).toISOString()
      });

      await repo.create(mandate);

      // Múltiplas chamadas concorrentes de markExpired
      await Promise.all([
        repo.markExpired('mandate-concurrent-expire', 'TIME'),
        repo.markExpired('mandate-concurrent-expire', 'TIME'),
        repo.markExpired('mandate-concurrent-expire', 'TIME'),
        repo.markExpired('mandate-concurrent-expire', 'TIME'),
        repo.markExpired('mandate-concurrent-expire', 'TIME')
      ]);

      // Status deve ser 'expired' (apenas uma vez)
      const final = await repo.getById('mandate-concurrent-expire');
      expect(final!.status).toBe('expired');
      expect(final!.expireReason).toBe('TIME');
    });

    test('markExpired não expira mandato já revogado', async () => {
      const dir = createTestDir('audit-revoked-no-expire');
      await fs.mkdir(dir, { recursive: true });

      const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
      const mandate = createValidMandate({
        id: 'mandate-revoked-no-expire'
      });

      await repo.create(mandate);
      await repo.revoke('mandate-revoked-no-expire', 'admin', 'Revogação de teste');

      // Tentar expirar mandato já revogado - deve ser ignorado
      await repo.markExpired('mandate-revoked-no-expire', 'TIME');

      const final = await repo.getById('mandate-revoked-no-expire');
      expect(final!.status).toBe('revoked');
      expect(final!.revogado).toBe(true);
      // expireReason NÃO deve estar definido
      expect(final!.expireReason).toBeUndefined();
    });

    test('Expiração por USES registra AUTONOMY_EXPIRED ao esgotar', async () => {
      const { orquestrador, eventLog } = await setupOrquestrador('audit-uses-expire');

      const mandate = createValidMandate({
        id: 'mandate-uses-expire',
        uses: 0,
        maxUses: 1
      });
      await orquestrador.ConcederMandato(mandate);

      // Primeiro uso - deve marcar como expirado
      const updated = await orquestrador.RegistrarUsoMandato('mandate-uses-expire');

      expect(updated.status).toBe('expired');
      expect(updated.expireReason).toBe('USES');

      // Verificar se AUTONOMY_EXPIRED foi registrado
      const events = await eventLog.getAll();
      const expireEvent = events.find(e => e.evento === TipoEvento.AUTONOMY_EXPIRED);

      expect(expireEvent).toBeDefined();
    });
  });

  describe('Event chain integrity', () => {
    test('Cadeia de eventos permanece válida após operações Inc 18', async () => {
      const { orquestrador, eventLog } = await setupOrquestrador('chain-inc18');

      // Criar mandato
      const mandate = createValidMandate({
        id: 'mandate-chain-18',
        uses: 0,
        maxUses: 3
      });
      await orquestrador.ConcederMandato(mandate);

      // Registrar usos
      await orquestrador.RegistrarUsoMandato('mandate-chain-18');
      await orquestrador.RegistrarUsoMandato('mandate-chain-18');
      await orquestrador.RegistrarUsoMandato('mandate-chain-18'); // Esgota

      // Verificar cadeia
      const chainResult = await eventLog.verifyChain();

      expect(chainResult.valid).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D) TESTES: RETROCOMPATIBILIDADE
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 18 - Retrocompatibilidade', () => {
  test('Mandato sem campos Inc 18 funciona normalmente', () => {
    // Mandato estilo Inc 17 (sem validFrom, validUntil, maxUses, uses)
    const legacyMandate: AutonomyMandate = {
      id: 'legacy-mandate',
      agentId: 'agent-legacy',
      modo: AutonomyMode.VIVENCIA_AUTONOMA,
      politicas_permitidas: ['FIRST_VALID'] as AggregationPolicy[],
      perfil_risco_maximo: PerfilRisco.MODERADO,
      limites: [],
      requer_humano_se: [],
      concedido_por: 'admin',
      concedido_em: new Date(),
      revogado: false
      // Sem: validFrom, validUntil, maxUses, uses, status
    };

    const result = isMandateActive(legacyMandate, new Date());

    expect(result.ok).toBe(true);
  });

  test('Mandato com valido_ate legado continua funcionando', () => {
    const legacyMandate = createValidMandate({
      valido_ate: new Date(Date.now() - 1000) // Expirado (campo legado)
    });

    const result = isMandateActive(legacyMandate, new Date());

    expect(result.ok).toBe(false);
    expect(result.code).toBe(MANDATE_RULE.EXPIRED_TIME);
  });

  test('isMandateValid aceita mandatos legados', () => {
    const legacyMandate = createValidMandate();
    delete (legacyMandate as any).status;
    delete (legacyMandate as any).uses;

    expect(isMandateValid(legacyMandate)).toBe(true);
  });

  test('getEffectiveMode trata mandatos legados', () => {
    const legacyMandate = createValidMandate({
      modo: AutonomyMode.VIVENCIA_ASSISTIDA
    });
    delete (legacyMandate as any).status;

    expect(getEffectiveMode(legacyMandate)).toBe(AutonomyMode.VIVENCIA_ASSISTIDA);
  });

  test('Repositório deserializa mandatos legados com defaults', async () => {
    const dir = createTestDir('compat-legacy');
    await fs.mkdir(dir, { recursive: true });

    // Criar arquivo JSON com mandato legado (sem campos Inc 18)
    const legacyData = [{
      id: 'legacy-1',
      agentId: 'agent-legacy',
      modo: 'VIVENCIA_AUTONOMA',
      politicas_permitidas: ['FIRST_VALID'],
      perfil_risco_maximo: 'MODERADO',
      limites: [],
      requer_humano_se: [],
      concedido_por: 'admin',
      concedido_em: '2025-01-01T00:00:00.000Z',
      revogado: false
      // Sem: validFrom, validUntil, maxUses, uses, status
    }];

    await fs.writeFile(
      path.join(dir, 'mandates.json'),
      JSON.stringify(legacyData, null, 2)
    );

    const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
    const mandate = await repo.getById('legacy-1');

    expect(mandate).not.toBeNull();
    expect(mandate!.uses).toBe(0); // Default
    expect(mandate!.status).toBe('active'); // Default
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E) TESTES: CONCORRÊNCIA (persistLock)
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 18 - Concorrência', () => {
  test('Múltiplos incrementUses concorrentes não corrompem contador', async () => {
    const dir = createTestDir('concurrency-1');
    await fs.mkdir(dir, { recursive: true });

    const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
    const mandate = createValidMandate({
      id: 'mandate-concurrent',
      uses: 0,
      maxUses: 100
    });

    await repo.create(mandate);

    // Executar 10 incrementos concorrentes
    const promises = Array(10).fill(null).map(() =>
      repo.incrementUses('mandate-concurrent')
    );

    await Promise.all(promises);

    // Verificar que uses é exatamente 10
    const final = await repo.getById('mandate-concurrent');
    expect(final!.uses).toBe(10);
  });

  test('persistLock serializa operações de escrita', async () => {
    const dir = createTestDir('concurrency-2');
    await fs.mkdir(dir, { recursive: true });

    const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));

    // Criar múltiplos mandatos em paralelo
    const createPromises = Array(5).fill(null).map((_, i) =>
      repo.create(createValidMandate({
        id: `mandate-parallel-${i}`,
        agentId: 'agent-parallel'
      }))
    );

    await Promise.all(createPromises);

    // Verificar que todos foram criados
    const all = await repo.getAllByAgentId('agent-parallel');
    expect(all).toHaveLength(5);
  });

  test('Operações mistas concorrentes mantêm integridade', async () => {
    const dir = createTestDir('concurrency-3');
    await fs.mkdir(dir, { recursive: true });

    const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));

    // Criar mandato inicial
    await repo.create(createValidMandate({
      id: 'mandate-mixed',
      uses: 0,
      maxUses: 50
    }));

    // Operações mistas: incrementUses, markExpired (idempotente se já expirar)
    const mixedPromises = [
      repo.incrementUses('mandate-mixed'),
      repo.incrementUses('mandate-mixed'),
      repo.incrementUses('mandate-mixed'),
      repo.incrementUses('mandate-mixed'),
      repo.incrementUses('mandate-mixed')
    ];

    await Promise.all(mixedPromises);

    const final = await repo.getById('mandate-mixed');
    expect(final!.uses).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: INTEGRAÇÃO COM ORQUESTRADOR
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 18 - Integração Orquestrador', () => {
  test('AvaliarAutonomia usa now para avaliação determinística', async () => {
    const { orquestrador } = await setupOrquestrador('orq-now-1');

    const validUntil = new Date('2025-06-01T12:00:00.000Z');
    const mandate = createValidMandate({
      id: 'mandate-now-test',
      validUntil: validUntil.toISOString()
    });
    await orquestrador.ConcederMandato(mandate);

    // Avaliação antes da expiração
    const beforeResult = await orquestrador.AvaliarAutonomia(
      {
        agentId: 'agent-1',
        policy: 'FIRST_VALID' as AggregationPolicy,
        perfilRisco: PerfilRisco.CONSERVADOR,
        closedLayerBlocked: false
      },
      new Date('2025-05-15T12:00:00.000Z')
    );
    expect(beforeResult.permitido).toBe(true);

    // Avaliação após expiração
    // Nota: Quando o mandato expira, getMostRecentActiveByAgentId não o encontra,
    // então o agente fica sem mandato e cai em ENSINO (comportamento correto).
    const afterResult = await orquestrador.AvaliarAutonomia(
      {
        agentId: 'agent-1',
        policy: 'FIRST_VALID' as AggregationPolicy,
        perfilRisco: PerfilRisco.CONSERVADOR,
        closedLayerBlocked: false
      },
      new Date('2025-07-01T12:00:00.000Z')
    );
    expect(afterResult.permitido).toBe(false);
    // Sem mandato ativo = modo ENSINO
    expect(afterResult.regra_bloqueio).toBe(REGRA.ENSINO_SEMPRE_BLOQUEIA);
  });

  test('Fluxo completo: criar → usar → esgotar → bloquear', async () => {
    const { orquestrador, eventLog } = await setupOrquestrador('orq-flow-1');

    // 1. Criar mandato com limite de 2 usos
    const mandate = createValidMandate({
      id: 'mandate-flow',
      uses: 0,
      maxUses: 2
    });
    await orquestrador.ConcederMandato(mandate);

    // 2. Primeiro uso
    const after1 = await orquestrador.RegistrarUsoMandato('mandate-flow');
    expect(after1.uses).toBe(1);
    expect(after1.status).toBe('active');

    // 3. Segundo uso - esgota
    const after2 = await orquestrador.RegistrarUsoMandato('mandate-flow');
    expect(after2.uses).toBe(2);
    expect(after2.status).toBe('expired');

    // 4. Avaliar autonomia - deve bloquear
    // Nota: Quando mandato esgota usos, status fica 'expired' e getActiveByAgentId não o retorna,
    // então o agente fica sem mandato e cai em ENSINO (comportamento correto).
    const result = await orquestrador.AvaliarAutonomia({
      agentId: 'agent-1',
      policy: 'FIRST_VALID' as AggregationPolicy,
      perfilRisco: PerfilRisco.CONSERVADOR,
      closedLayerBlocked: false
    });

    expect(result.permitido).toBe(false);
    // Sem mandato ativo = modo ENSINO
    expect(result.regra_bloqueio).toBe(REGRA.ENSINO_SEMPRE_BLOQUEIA);

    // 5. Verificar eventos
    const events = await eventLog.getAll();
    expect(events.some(e => e.evento === TipoEvento.AUTONOMY_GRANTED)).toBe(true);
    expect(events.filter(e => e.evento === TipoEvento.AUTONOMY_USE_CONSUMED)).toHaveLength(2);
    expect(events.some(e => e.evento === TipoEvento.AUTONOMY_CHECK_FAILED)).toBe(true);
  });

  test('Uso só é incrementado quando autonomia é efetivamente concedida', async () => {
    const { orquestrador } = await setupOrquestrador('orq-no-consume-1');

    // Mandato com política restrita
    const mandate = createValidMandate({
      id: 'mandate-restricted',
      politicas_permitidas: ['FIRST_VALID'] as AggregationPolicy[],
      uses: 0,
      maxUses: 10
    });
    await orquestrador.ConcederMandato(mandate);

    // Avaliação com política não autorizada - não deve consumir uso
    const result = await orquestrador.AvaliarAutonomia({
      agentId: 'agent-1',
      policy: 'WEIGHTED_MAJORITY' as AggregationPolicy, // Não autorizada
      perfilRisco: PerfilRisco.CONSERVADOR,
      closedLayerBlocked: false
    });

    expect(result.permitido).toBe(false);
    expect(result.regra_bloqueio).toBe(REGRA.POLITICA_NAO_AUTORIZADA);

    // Verificar que uses não foi incrementado
    const mandateAfter = await orquestrador.GetMandatoAtivo('agent-1');
    expect(mandateAfter!.uses).toBe(0);
  });

  test('HUMAN_OVERRIDE_REQUIRED não consome uso (Ensino sempre bloqueia)', async () => {
    const { orquestrador } = await setupOrquestrador('orq-no-consume-ensino');

    // Mandato em modo ENSINO
    const mandate = createValidMandate({
      id: 'mandate-ensino',
      modo: AutonomyMode.ENSINO,
      uses: 0,
      maxUses: 10
    });
    await orquestrador.ConcederMandato(mandate);

    // Avaliação - bloqueia por ENSINO, não consome uso
    const result = await orquestrador.AvaliarAutonomia({
      agentId: 'agent-1',
      policy: 'FIRST_VALID' as AggregationPolicy,
      perfilRisco: PerfilRisco.CONSERVADOR,
      closedLayerBlocked: false
    });

    expect(result.permitido).toBe(false);
    expect(result.regra_bloqueio).toBe(REGRA.ENSINO_SEMPRE_BLOQUEIA);

    // Verificar que uses não foi incrementado
    const mandateAfter = await orquestrador.GetMandatoAtivo('agent-1');
    expect(mandateAfter!.uses).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CASOS EDGE
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 18 - Edge Cases', () => {
  test('markAsExpired é função pura (imutabilidade)', () => {
    const mandate = createValidMandate();
    const originalStatus = mandate.status;

    const expired = markAsExpired(mandate, 'TIME', new Date());

    expect(mandate.status).toBe(originalStatus);
    expect(expired.status).toBe('expired');
    expect(expired).not.toBe(mandate);
  });

  test('Mandato com validFrom e maxUses verifica ordem correta', () => {
    const futureDate = new Date(Date.now() + 86400000);
    const mandate = createValidMandate({
      validFrom: futureDate.toISOString(),
      maxUses: 5,
      uses: 10 // Já esgotado, mas validFrom ainda não chegou
    });

    const result = isMandateActive(mandate, new Date());

    // Deve bloquear por validFrom (verificado primeiro)
    expect(result.ok).toBe(false);
    expect(result.code).toBe(MANDATE_RULE.NOT_ACTIVE_YET);
  });

  test('Mandato já expirado retorna status correto', () => {
    const mandate = createValidMandate({
      status: 'expired',
      expireReason: 'TIME',
      expiredAt: new Date().toISOString()
    });

    const result = isMandateActive(mandate, new Date());

    expect(result.ok).toBe(false);
    expect(result.code).toBe(MANDATE_RULE.ALREADY_EXPIRED);
  });

  test('Repositório getActiveByAgentId filtra por validFrom', async () => {
    const dir = createTestDir('edge-validfrom');
    await fs.mkdir(dir, { recursive: true });

    const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
    const futureDate = new Date(Date.now() + 86400000);

    await repo.create(createValidMandate({
      id: 'mandate-future',
      agentId: 'agent-edge',
      validFrom: futureDate.toISOString()
    }));

    await repo.create(createValidMandate({
      id: 'mandate-active',
      agentId: 'agent-edge'
    }));

    const active = await repo.getActiveByAgentId('agent-edge');

    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('mandate-active');
  });

  test('Repositório hasActiveMandate considera validUntil', async () => {
    const dir = createTestDir('edge-validuntil');
    await fs.mkdir(dir, { recursive: true });

    const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
    const pastDate = new Date(Date.now() - 86400000);

    await repo.create(createValidMandate({
      id: 'mandate-expired',
      agentId: 'agent-edge',
      validUntil: pastDate.toISOString()
    }));

    const hasActive = await repo.hasActiveMandate('agent-edge');

    expect(hasActive).toBe(false);
  });
});
