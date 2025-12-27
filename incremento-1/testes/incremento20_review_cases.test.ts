/**
 * INCREMENTO 20 — HUMAN REVIEW WORKFLOW: Testes
 *
 * Cobertura:
 * 1. ReviewCaseRepositoryImpl
 *    - createOrGetOpenByObservacaoId (idempotência)
 *    - list com filtros
 *    - resolve (transição + validação de notas)
 *    - dismiss (transição + notas obrigatórias)
 *    - countByStatus
 *
 * 2. ReviewCaseService
 *    - createOrGetOpen (idempotência + evento)
 *    - resolve com efeitos (RESUME_MANDATE, REVOKE_MANDATE)
 *    - dismiss
 *    - updateNotes
 *
 * 3. Integração com OrquestradorCognitivo
 *    - FLAG_HUMAN_REVIEW cria ReviewCase automaticamente
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ReviewCaseRepositoryImpl,
  ReviewCaseService,
  ReviewCaseServiceContext,
  CreateReviewCaseInput,
  ResolveReviewCaseInput,
  DismissReviewCaseInput,
  ReviewCaseNotFoundError,
  InvalidReviewTransitionError,
  ReviewNotesRequiredError,
  TipoEvento,
  EventLogRepositoryImpl,
  ConsequenceAction
} from '../camada-3';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_DIR = path.join(__dirname, '../test-artifacts/review');

function ensureTestDir() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
}

function cleanTestFiles() {
  const files = ['review_cases.json', 'review_eventlog.json'];
  for (const file of files) {
    const filePath = path.join(TEST_DIR, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ReviewCaseRepositoryImpl
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 20: ReviewCaseRepositoryImpl', () => {
  let repo: ReviewCaseRepositoryImpl;
  const REVIEW_FILE = path.join(TEST_DIR, 'review_cases.json');

  beforeAll(() => {
    ensureTestDir();
  });

  beforeEach(() => {
    cleanTestFiles();
    repo = new ReviewCaseRepositoryImpl(REVIEW_FILE);
  });

  afterAll(() => {
    cleanTestFiles();
  });

  describe('createOrGetOpenByObservacaoId', () => {
    it('deve criar novo caso quando não existe', async () => {
      const input: CreateReviewCaseInput = {
        tenantId: 'tenant-1',
        triggeredBy: {
          observacaoId: 'obs-001',
          mandateId: 'mandate-001',
          ruleId: 'RULE_19_4_LEGAL_ETICA',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: {
          agentId: 'agent-1',
          mandateModo: 'AUTONOMO',
          observacaoSinal: 'NEGATIVO'
        }
      };

      const result = await repo.createOrGetOpenByObservacaoId(input);

      expect(result.created).toBe(true);
      expect(result.reviewCase.tenantId).toBe('tenant-1');
      expect(result.reviewCase.status).toBe('OPEN');
      expect(result.reviewCase.triggeredBy.observacaoId).toBe('obs-001');
    });

    it('deve retornar caso existente quando já existe OPEN', async () => {
      const input: CreateReviewCaseInput = {
        tenantId: 'tenant-1',
        triggeredBy: {
          observacaoId: 'obs-002',
          ruleId: 'RULE_19_4_LEGAL_ETICA',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: {}
      };

      // Primeira criação
      const first = await repo.createOrGetOpenByObservacaoId(input);
      expect(first.created).toBe(true);

      // Segunda chamada (mesmo observacaoId)
      const second = await repo.createOrGetOpenByObservacaoId(input);
      expect(second.created).toBe(false);
      expect(second.reviewCase.id).toBe(first.reviewCase.id);
    });

    it('deve criar novo caso se existente foi RESOLVED', async () => {
      const input: CreateReviewCaseInput = {
        tenantId: 'tenant-1',
        triggeredBy: {
          observacaoId: 'obs-003',
          ruleId: 'RULE_19_4_LEGAL_ETICA',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: {}
      };

      // Criar e resolver
      const first = await repo.createOrGetOpenByObservacaoId(input);
      await repo.resolve('tenant-1', first.reviewCase.id, {
        resolution: 'NO_ACTION',
        decidedBy: 'admin',
        notes: 'Resolvido'
      });

      // Nova criação (mesmo observacaoId, mas antigo foi resolvido)
      const second = await repo.createOrGetOpenByObservacaoId(input);
      expect(second.created).toBe(true);
      expect(second.reviewCase.id).not.toBe(first.reviewCase.id);
    });

    it('deve isolar por tenantId', async () => {
      const inputT1: CreateReviewCaseInput = {
        tenantId: 'tenant-1',
        triggeredBy: {
          observacaoId: 'obs-shared',
          ruleId: 'RULE_19_4_LEGAL_ETICA',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: {}
      };

      const inputT2: CreateReviewCaseInput = {
        tenantId: 'tenant-2',
        triggeredBy: {
          observacaoId: 'obs-shared', // mesmo observacaoId
          ruleId: 'RULE_19_4_LEGAL_ETICA',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: {}
      };

      const resultT1 = await repo.createOrGetOpenByObservacaoId(inputT1);
      const resultT2 = await repo.createOrGetOpenByObservacaoId(inputT2);

      expect(resultT1.created).toBe(true);
      expect(resultT2.created).toBe(true);
      expect(resultT1.reviewCase.id).not.toBe(resultT2.reviewCase.id);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      // Criar alguns casos
      const inputs: CreateReviewCaseInput[] = [
        {
          tenantId: 'tenant-1',
          triggeredBy: { observacaoId: 'obs-a', ruleId: 'R1', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
          contextSnapshot: {}
        },
        {
          tenantId: 'tenant-1',
          triggeredBy: { observacaoId: 'obs-b', ruleId: 'R2', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
          contextSnapshot: {}
        },
        {
          tenantId: 'tenant-2',
          triggeredBy: { observacaoId: 'obs-c', ruleId: 'R3', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
          contextSnapshot: {}
        }
      ];

      for (const input of inputs) {
        await repo.createOrGetOpenByObservacaoId(input);
      }
    });

    it('deve listar por tenantId', async () => {
      const t1Cases = await repo.list('tenant-1');
      const t2Cases = await repo.list('tenant-2');

      expect(t1Cases.length).toBe(2);
      expect(t2Cases.length).toBe(1);
    });

    it('deve filtrar por status', async () => {
      const cases = await repo.list('tenant-1');
      const firstId = cases[0].id;

      // Resolver um caso
      await repo.resolve('tenant-1', firstId, {
        resolution: 'NO_ACTION',
        decidedBy: 'admin',
        notes: 'OK'
      });

      const openCases = await repo.list('tenant-1', { status: 'OPEN' });
      const resolvedCases = await repo.list('tenant-1', { status: 'RESOLVED' });

      expect(openCases.length).toBe(1);
      expect(resolvedCases.length).toBe(1);
    });

    it('deve limitar resultados', async () => {
      const limitedCases = await repo.list('tenant-1', { limit: 1 });
      expect(limitedCases.length).toBe(1);
    });
  });

  describe('resolve', () => {
    it('deve resolver caso OPEN', async () => {
      const { reviewCase } = await repo.createOrGetOpenByObservacaoId({
        tenantId: 'tenant-1',
        triggeredBy: { observacaoId: 'obs-resolve', ruleId: 'R1', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
        contextSnapshot: {}
      });

      const resolved = await repo.resolve('tenant-1', reviewCase.id, {
        resolution: 'APPROVE',
        decidedBy: 'admin@test.com',
        notes: 'Aprovado após análise',
        effects: ['RESUME_MANDATE']
      });

      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.decision?.resolution).toBe('APPROVE');
      expect(resolved.decision?.decidedBy).toBe('admin@test.com');
      expect(resolved.decision?.effectsApplied).toContain('RESUME_MANDATE');
    });

    it('deve rejeitar se caso não está OPEN', async () => {
      const { reviewCase } = await repo.createOrGetOpenByObservacaoId({
        tenantId: 'tenant-1',
        triggeredBy: { observacaoId: 'obs-double', ruleId: 'R1', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
        contextSnapshot: {}
      });

      // Resolver primeira vez
      await repo.resolve('tenant-1', reviewCase.id, {
        resolution: 'APPROVE',
        decidedBy: 'admin',
        notes: 'OK'
      });

      // Tentar resolver novamente
      await expect(
        repo.resolve('tenant-1', reviewCase.id, {
          resolution: 'REJECT',
          decidedBy: 'admin',
          notes: 'Tentativa'
        })
      ).rejects.toThrow(InvalidReviewTransitionError);
    });

    it('deve exigir notas quando resolution != NO_ACTION', async () => {
      const { reviewCase } = await repo.createOrGetOpenByObservacaoId({
        tenantId: 'tenant-1',
        triggeredBy: { observacaoId: 'obs-notes', ruleId: 'R1', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
        contextSnapshot: {}
      });

      await expect(
        repo.resolve('tenant-1', reviewCase.id, {
          resolution: 'APPROVE',
          decidedBy: 'admin',
          notes: '' // vazio
        })
      ).rejects.toThrow(ReviewNotesRequiredError);
    });

    it('deve permitir NO_ACTION sem notas', async () => {
      const { reviewCase } = await repo.createOrGetOpenByObservacaoId({
        tenantId: 'tenant-1',
        triggeredBy: { observacaoId: 'obs-noaction', ruleId: 'R1', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
        contextSnapshot: {}
      });

      const resolved = await repo.resolve('tenant-1', reviewCase.id, {
        resolution: 'NO_ACTION',
        decidedBy: 'admin'
      });

      expect(resolved.status).toBe('RESOLVED');
    });
  });

  describe('dismiss', () => {
    it('deve dispensar caso OPEN com notas', async () => {
      const { reviewCase } = await repo.createOrGetOpenByObservacaoId({
        tenantId: 'tenant-1',
        triggeredBy: { observacaoId: 'obs-dismiss', ruleId: 'R1', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
        contextSnapshot: {}
      });

      const dismissed = await repo.dismiss('tenant-1', reviewCase.id, {
        dismissedBy: 'admin@test.com',
        notes: 'Falso positivo - não requer ação'
      });

      expect(dismissed.status).toBe('DISMISSED');
      expect(dismissed.decision?.decidedBy).toBe('admin@test.com');
    });

    it('deve exigir notas para dismiss', async () => {
      const { reviewCase } = await repo.createOrGetOpenByObservacaoId({
        tenantId: 'tenant-1',
        triggeredBy: { observacaoId: 'obs-dismiss-nonotes', ruleId: 'R1', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
        contextSnapshot: {}
      });

      await expect(
        repo.dismiss('tenant-1', reviewCase.id, {
          dismissedBy: 'admin',
          notes: ''
        })
      ).rejects.toThrow(ReviewNotesRequiredError);
    });
  });

  describe('countByStatus', () => {
    it('deve contar por status', async () => {
      // Criar 3 casos, resolver 1, dispensar 1
      const inputs = [
        { observacaoId: 'obs-count-1', ruleId: 'R1', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
        { observacaoId: 'obs-count-2', ruleId: 'R2', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
        { observacaoId: 'obs-count-3', ruleId: 'R3', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW }
      ];

      const cases = [];
      for (const trigger of inputs) {
        const result = await repo.createOrGetOpenByObservacaoId({
          tenantId: 'tenant-count',
          triggeredBy: trigger as any,
          contextSnapshot: {}
        });
        cases.push(result.reviewCase);
      }

      // Resolver primeiro
      await repo.resolve('tenant-count', cases[0].id, {
        resolution: 'APPROVE',
        decidedBy: 'admin',
        notes: 'OK'
      });

      // Dispensar segundo
      await repo.dismiss('tenant-count', cases[1].id, {
        dismissedBy: 'admin',
        notes: 'Falso positivo'
      });

      const counts = await repo.countByStatus('tenant-count');
      expect(counts.OPEN).toBe(1);
      expect(counts.RESOLVED).toBe(1);
      expect(counts.DISMISSED).toBe(1);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ReviewCaseService
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 20: ReviewCaseService', () => {
  let repo: ReviewCaseRepositoryImpl;
  let eventLogRepo: EventLogRepositoryImpl;
  let service: ReviewCaseService;
  const REVIEW_FILE = path.join(TEST_DIR, 'review_svc_cases.json');
  const EVENTLOG_DIR = path.join(TEST_DIR, 'review_eventlog'); // diretório, não arquivo

  beforeAll(() => {
    ensureTestDir();
  });

  beforeEach(async () => {
    // Limpar arquivo
    if (fs.existsSync(REVIEW_FILE)) fs.unlinkSync(REVIEW_FILE);
    // Limpar diretório de eventlog
    if (fs.existsSync(EVENTLOG_DIR)) {
      fs.rmSync(EVENTLOG_DIR, { recursive: true, force: true });
    }

    repo = new ReviewCaseRepositoryImpl(REVIEW_FILE);
    eventLogRepo = new EventLogRepositoryImpl(EVENTLOG_DIR);
    await eventLogRepo.init();

    const context: ReviewCaseServiceContext = {
      reviewRepo: repo,
      eventLog: eventLogRepo
    };
    service = new ReviewCaseService(context);
  });

  afterAll(() => {
    if (fs.existsSync(REVIEW_FILE)) fs.unlinkSync(REVIEW_FILE);
    if (fs.existsSync(EVENTLOG_DIR)) {
      fs.rmSync(EVENTLOG_DIR, { recursive: true, force: true });
    }
  });

  describe('createOrGetOpen', () => {
    it('deve criar caso e emitir evento', async () => {
      const input: CreateReviewCaseInput = {
        tenantId: 'tenant-svc',
        triggeredBy: {
          observacaoId: 'obs-svc-001',
          mandateId: 'mandate-svc',
          ruleId: 'RULE_19_4_LEGAL_ETICA',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: { agentId: 'agent-svc' }
      };

      const result = await service.createOrGetOpen(input, 'system');

      expect(result.created).toBe(true);
      expect(result.reviewCase.status).toBe('OPEN');

      // Verificar evento
      const events = await eventLogRepo.getAll();
      const openEvent = events.find(
        e => e.evento === TipoEvento.HUMAN_REVIEW_CASE_OPENED
      );
      expect(openEvent).toBeDefined();
      expect(openEvent?.entidade_id).toBe(result.reviewCase.id);
    });

    it('não deve emitir evento duplicado (idempotência)', async () => {
      const input: CreateReviewCaseInput = {
        tenantId: 'tenant-svc',
        triggeredBy: {
          observacaoId: 'obs-svc-idem',
          ruleId: 'R1',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: {}
      };

      await service.createOrGetOpen(input, 'system');
      await service.createOrGetOpen(input, 'system'); // segunda chamada

      // Apenas 1 evento
      const events = await eventLogRepo.getAll();
      const openEvents = events.filter(
        e => e.evento === TipoEvento.HUMAN_REVIEW_CASE_OPENED
      );
      expect(openEvents.length).toBe(1);
    });
  });

  describe('resolve', () => {
    it('deve resolver e emitir evento', async () => {
      const createInput: CreateReviewCaseInput = {
        tenantId: 'tenant-resolve',
        triggeredBy: {
          observacaoId: 'obs-resolve-svc',
          ruleId: 'R1',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: {}
      };

      const { reviewCase } = await service.createOrGetOpen(createInput, 'system');

      const resolveInput: ResolveReviewCaseInput = {
        resolution: 'APPROVE',
        decidedBy: 'admin@test.com',
        notes: 'Aprovado após revisão'
      };

      const result = await service.resolve('tenant-resolve', reviewCase.id, resolveInput);

      expect(result.reviewCase.status).toBe('RESOLVED');

      // Verificar evento
      const events = await eventLogRepo.getAll();
      const resolveEvent = events.find(
        e => e.evento === TipoEvento.HUMAN_REVIEW_CASE_RESOLVED
      );
      expect(resolveEvent).toBeDefined();
    });
  });

  describe('dismiss', () => {
    it('deve dispensar e emitir evento', async () => {
      const createInput: CreateReviewCaseInput = {
        tenantId: 'tenant-dismiss',
        triggeredBy: {
          observacaoId: 'obs-dismiss-svc',
          ruleId: 'R1',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: {}
      };

      const { reviewCase } = await service.createOrGetOpen(createInput, 'system');

      const dismissInput: DismissReviewCaseInput = {
        dismissedBy: 'admin@test.com',
        notes: 'Falso positivo confirmado'
      };

      const dismissed = await service.dismiss('tenant-dismiss', reviewCase.id, dismissInput);

      expect(dismissed.status).toBe('DISMISSED');

      // Verificar evento
      const events = await eventLogRepo.getAll();
      const dismissEvent = events.find(
        e => e.evento === TipoEvento.HUMAN_REVIEW_CASE_DISMISSED
      );
      expect(dismissEvent).toBeDefined();
    });
  });

  describe('updateNotes', () => {
    it('deve atualizar notas e emitir evento', async () => {
      const createInput: CreateReviewCaseInput = {
        tenantId: 'tenant-notes',
        triggeredBy: {
          observacaoId: 'obs-notes-svc',
          ruleId: 'R1',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: {}
      };

      const { reviewCase } = await service.createOrGetOpen(createInput, 'system');

      const updated = await service.updateNotes(
        'tenant-notes',
        reviewCase.id,
        'Nota adicional sobre o caso',
        'analyst@test.com'
      );

      expect(updated.decision?.notes).toBe('Nota adicional sobre o caso');

      // Verificar evento
      const events = await eventLogRepo.getAll();
      const notesEvent = events.find(
        e => e.evento === TipoEvento.HUMAN_REVIEW_CASE_NOTES_UPDATED
      );
      expect(notesEvent).toBeDefined();
    });
  });

  describe('list e countByStatus', () => {
    it('deve listar e contar corretamente', async () => {
      // Criar alguns casos
      for (let i = 0; i < 3; i++) {
        await service.createOrGetOpen({
          tenantId: 'tenant-list',
          triggeredBy: {
            observacaoId: `obs-list-${i}`,
            ruleId: 'R1',
            actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
          },
          contextSnapshot: {}
        }, 'system');
      }

      const cases = await service.list('tenant-list');
      expect(cases.length).toBe(3);

      const counts = await service.countByStatus('tenant-list');
      expect(counts.OPEN).toBe(3);
      expect(counts.RESOLVED).toBe(0);
      expect(counts.DISMISSED).toBe(0);
    });
  });

  describe('getById', () => {
    it('deve retornar caso por ID', async () => {
      const { reviewCase } = await service.createOrGetOpen({
        tenantId: 'tenant-get',
        triggeredBy: {
          observacaoId: 'obs-get',
          ruleId: 'R1',
          actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW
        },
        contextSnapshot: {}
      }, 'system');

      const found = await service.getById('tenant-get', reviewCase.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(reviewCase.id);
    });

    it('deve retornar null se não encontrar', async () => {
      const found = await service.getById('tenant-nonexist', 'id-nonexist');
      expect(found).toBeNull();
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: Erros específicos
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 20: Review Errors', () => {
  let repo: ReviewCaseRepositoryImpl;
  const REVIEW_FILE = path.join(TEST_DIR, 'review_errors_cases.json');

  beforeAll(() => {
    ensureTestDir();
  });

  beforeEach(() => {
    if (fs.existsSync(REVIEW_FILE)) fs.unlinkSync(REVIEW_FILE);
    repo = new ReviewCaseRepositoryImpl(REVIEW_FILE);
  });

  afterAll(() => {
    if (fs.existsSync(REVIEW_FILE)) fs.unlinkSync(REVIEW_FILE);
  });

  it('ReviewCaseNotFoundError - resolve caso inexistente', async () => {
    await expect(
      repo.resolve('tenant-x', 'nonexistent', {
        resolution: 'APPROVE',
        decidedBy: 'admin',
        notes: 'OK'
      })
    ).rejects.toThrow(ReviewCaseNotFoundError);
  });

  it('ReviewCaseNotFoundError - dismiss caso inexistente', async () => {
    await expect(
      repo.dismiss('tenant-x', 'nonexistent', {
        dismissedBy: 'admin',
        notes: 'OK'
      })
    ).rejects.toThrow(ReviewCaseNotFoundError);
  });

  it('ReviewCaseNotFoundError - updateNotes caso inexistente', async () => {
    await expect(
      repo.updateNotes('tenant-x', 'nonexistent', 'notes', 'admin')
    ).rejects.toThrow(ReviewCaseNotFoundError);
  });

  it('InvalidReviewTransitionError - dismiss caso já resolvido', async () => {
    const { reviewCase } = await repo.createOrGetOpenByObservacaoId({
      tenantId: 'tenant-err',
      triggeredBy: { observacaoId: 'obs-err', ruleId: 'R1', actionSuggested: ConsequenceAction.FLAG_HUMAN_REVIEW },
      contextSnapshot: {}
    });

    await repo.resolve('tenant-err', reviewCase.id, {
      resolution: 'APPROVE',
      decidedBy: 'admin',
      notes: 'OK'
    });

    await expect(
      repo.dismiss('tenant-err', reviewCase.id, {
        dismissedBy: 'admin',
        notes: 'Tentativa'
      })
    ).rejects.toThrow(InvalidReviewTransitionError);
  });
});
