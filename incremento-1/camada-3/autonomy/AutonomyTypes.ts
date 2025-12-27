/**
 * INCREMENTO 17 + 18 + 19 — AUTONOMIA GRADUADA: Tipos Principais
 *
 * Define os tipos para governança de autonomia em decisões.
 *
 * Autonomia Graduada = separação formal entre:
 * - Ensino (sempre supervisionado)
 * - Vivência Assistida (autonomia parcial com limites)
 * - Vivência Autônoma (decisão plena dentro de mandatos)
 *
 * INCREMENTO 18 adiciona:
 * - Mandatos com validade temporal (validFrom, validUntil)
 * - Mandatos com limite de usos (maxUses, uses)
 * - Expiração automática com auditoria
 *
 * INCREMENTO 19 adiciona:
 * - Status 'suspended' para mandatos
 * - Campos de suspensão (suspendedAt, suspendReason, triggeredByObservacaoId)
 * - Feedback loop: consequências alteram autonomia
 *
 * PRINCÍPIOS:
 * - Ensino cria base
 * - Vivência cria sabedoria
 * - Autonomia é concedida gradualmente, nunca assumida por padrão
 * - Mandatos são explícitos, revogáveis e auditáveis
 * - A autonomia é sempre: por agente, por política, por perfil de risco
 * - A autonomia não é um direito, é um mandato condicionado ao histórico
 */

import { PerfilRisco, Limite } from '../entidades/tipos';
import { ActorId } from '../event-log/EventLogEntry';
import { AggregationPolicy } from '../multiagente/MultiAgentTypes';

// ════════════════════════════════════════════════════════════════════════════
// STATUS DO MANDATO (INCREMENTO 18 + 19)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Status do mandato.
 * - active: mandato está ativo e pode ser usado
 * - expired: mandato expirou (por tempo ou usos)
 * - revoked: mandato foi revogado manualmente
 * - suspended: mandato suspenso por consequência (Inc 19) - pode ser retomado
 */
type MandateStatus = 'active' | 'expired' | 'revoked' | 'suspended';

/**
 * Motivo da expiração do mandato.
 * - TIME: expirou por validUntil
 * - USES: expirou por maxUses atingido
 */
type MandateExpireReason = 'TIME' | 'USES';

// ════════════════════════════════════════════════════════════════════════════
// MODOS DE AUTONOMIA
// ════════════════════════════════════════════════════════════════════════════

/**
 * AutonomyMode - Modos de autonomia disponíveis.
 *
 * ENSINO: Sempre requer humano para decidir
 * VIVENCIA_ASSISTIDA: Depende de regras do mandato
 * VIVENCIA_AUTONOMA: Sem intervenção humana (dentro do mandato)
 */
enum AutonomyMode {
  /** Modo de ensino - decisão sempre supervisionada */
  ENSINO = 'ENSINO',

  /** Modo de vivência assistida - autonomia parcial com limites */
  VIVENCIA_ASSISTIDA = 'VIVENCIA_ASSISTIDA',

  /** Modo de vivência autônoma - decisão plena dentro de mandatos */
  VIVENCIA_AUTONOMA = 'VIVENCIA_AUTONOMA'
}

// ════════════════════════════════════════════════════════════════════════════
// MANDATO DE AUTONOMIA
// ════════════════════════════════════════════════════════════════════════════

/**
 * AutonomyMandate - Mandato explícito de autonomia.
 *
 * Define o que um agente pode fazer autonomamente.
 * Mandatos são:
 * - Explícitos (nunca inferidos)
 * - Revogáveis (podem ser cancelados)
 * - Auditáveis (registrados no EventLog)
 * - Temporais (podem ter validade)
 * - Limitados por uso (Incremento 18)
 */
interface AutonomyMandate {
  /** ID único do mandato */
  id: string;

  /** ID do agente que recebe o mandato */
  agentId: string;

  /** Modo de autonomia concedido */
  modo: AutonomyMode;

  /** Políticas de agregação permitidas */
  politicas_permitidas: AggregationPolicy[];

  /** Perfil de risco máximo permitido */
  perfil_risco_maximo: PerfilRisco;

  /** Limites invioláveis do mandato */
  limites: Limite[];

  /** Gatilhos textuais que requerem humano */
  requer_humano_se: string[];

  /** Domínios permitidos (vazio = todos) */
  dominios_permitidos?: string[];

  /** Casos de uso permitidos (vazio = todos) */
  casos_uso_permitidos?: number[];

  /** Ator que concedeu o mandato */
  concedido_por: ActorId;

  /** Data de concessão */
  concedido_em: Date;

  /** Data de validade (undefined = sem expiração) - LEGADO Inc 17 */
  valido_ate?: Date;

  /** Se o mandato foi revogado */
  revogado: boolean;

  /** Data de revogação (se aplicável) */
  revogado_em?: Date;

  /** Ator que revogou (se aplicável) */
  revogado_por?: ActorId;

  /** Motivo da revogação (se aplicável) */
  motivo_revogacao?: string;

  // ══════════════════════════════════════════════════════════════════════════
  // CAMPOS DO INCREMENTO 18 - VALIDADE TEMPORAL E LIMITE DE USOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Data a partir da qual o mandato é válido (ISO string).
   * Se não especificado, válido imediatamente.
   */
  validFrom?: string;

  /**
   * Data até a qual o mandato é válido (ISO string).
   * Se não especificado, sem limite de tempo.
   * Nota: valido_ate é legado do Inc 17, validUntil é o novo campo.
   */
  validUntil?: string;

  /**
   * Número máximo de usos permitidos.
   * Se não especificado, sem limite de usos.
   */
  maxUses?: number;

  /**
   * Contador de usos atuais.
   * Incrementado quando autonomia é efetivamente concedida.
   * Default: 0
   */
  uses?: number;

  /**
   * Data do último uso (ISO string).
   */
  lastUsedAt?: string;

  /**
   * Status do mandato.
   * Default: 'active' (retrocompatível com mandatos antigos).
   */
  status?: MandateStatus;

  /**
   * Data de expiração (ISO string).
   * Preenchido quando status muda para 'expired'.
   */
  expiredAt?: string;

  /**
   * Motivo da expiração.
   * - TIME: expirou por validUntil
   * - USES: expirou por maxUses atingido
   */
  expireReason?: MandateExpireReason;

  // ══════════════════════════════════════════════════════════════════════════
  // CAMPOS DO INCREMENTO 19 - SUSPENSÃO POR CONSEQUÊNCIA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Data de suspensão (ISO string).
   * Preenchido quando status muda para 'suspended'.
   */
  suspendedAt?: string;

  /**
   * Motivo da suspensão.
   * Texto canônico descrevendo a causa.
   */
  suspendReason?: string;

  /**
   * ID da observação de consequência que disparou a ação.
   * Usado para auditoria e idempotência.
   */
  triggeredByObservacaoId?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// INPUT PARA AVALIAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Input para avaliação de autonomia.
 */
interface AutonomyCheckInput {
  /** ID do agente */
  agentId: string;

  /** Política de agregação sendo usada */
  policy: AggregationPolicy;

  /** Perfil de risco da decisão */
  perfilRisco: PerfilRisco;

  /** Se foi bloqueado pela Camada Fechada */
  closedLayerBlocked: boolean;

  /** Domínio da situação */
  dominio?: string;

  /** Caso de uso */
  casoUso?: number;

  /** Mandato do agente (se houver) */
  mandate?: AutonomyMandate;

  /** Contexto textual (para verificar gatilhos) */
  contexto?: string;

  /**
   * Modo de autonomia solicitado explicitamente pelo chamador.
   * Se especificado como VIVENCIA_* sem mandato válido, falha explicitamente
   * com MANDATE_REQUIRED (não rebaixa silenciosamente para ENSINO).
   *
   * Isso evita mascarar bugs de integração onde o chamador espera
   * operar em modo autônomo mas esqueceu de fornecer o mandato.
   */
  requestedMode?: AutonomyMode;

  /**
   * Data/hora atual para avaliação (Incremento 18).
   * Permite testes determinísticos sem depender de relógio real.
   * Default: new Date()
   */
  now?: Date;
}

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO DA AVALIAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado da avaliação de autonomia.
 */
interface AutonomyCheckResult {
  /** Se a autonomia é permitida */
  permitido: boolean;

  /** Modo de autonomia avaliado */
  modo: AutonomyMode;

  /** Motivo do bloqueio (se não permitido) */
  motivo?: string;

  /** ID do mandato usado (se aplicável) */
  mandato_id?: string;

  /** Regra que causou bloqueio (se aplicável) */
  regra_bloqueio?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// HIERARQUIA DE PERFIL DE RISCO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Ordem de perfis de risco para comparação.
 * Menor índice = mais conservador.
 */
const PERFIL_RISCO_ORDEM: Record<PerfilRisco, number> = {
  [PerfilRisco.CONSERVADOR]: 0,
  [PerfilRisco.MODERADO]: 1,
  [PerfilRisco.AGRESSIVO]: 2
};

/**
 * Verifica se um perfil de risco excede outro.
 * @param atual - Perfil atual
 * @param maximo - Perfil máximo permitido
 * @returns true se atual > máximo
 */
function perfilExcede(atual: PerfilRisco, maximo: PerfilRisco): boolean {
  return PERFIL_RISCO_ORDEM[atual] > PERFIL_RISCO_ORDEM[maximo];
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  // Tipos de status/expiração (Inc 18)
  MandateStatus,
  MandateExpireReason,
  // Modo de autonomia
  AutonomyMode,
  // Mandato
  AutonomyMandate,
  // Avaliação
  AutonomyCheckInput,
  AutonomyCheckResult,
  // Helpers de perfil de risco
  PERFIL_RISCO_ORDEM,
  perfilExcede
};
