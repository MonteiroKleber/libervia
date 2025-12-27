/**
 * INCREMENTO 18 — MANDATOS TEMPORAIS: Helpers de Tempo
 *
 * Funções puras para manipulação de datas em mandatos.
 * Sem side effects, sem I/O.
 */

/**
 * Converte string ISO para Date ou retorna null se inválido/undefined.
 */
function parseIsoDate(iso?: string | Date): Date | null {
  if (!iso) {
    return null;
  }

  if (iso instanceof Date) {
    return isNaN(iso.getTime()) ? null : iso;
  }

  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Verifica se a data A é anterior à data B.
 */
function isBefore(a: Date, b: Date): boolean {
  return a.getTime() < b.getTime();
}

/**
 * Verifica se a data A é posterior à data B.
 */
function isAfter(a: Date, b: Date): boolean {
  return a.getTime() > b.getTime();
}

/**
 * Verifica se a data A é igual ou anterior à data B.
 */
function isBeforeOrEqual(a: Date, b: Date): boolean {
  return a.getTime() <= b.getTime();
}

/**
 * Verifica se a data A é igual ou posterior à data B.
 */
function isAfterOrEqual(a: Date, b: Date): boolean {
  return a.getTime() >= b.getTime();
}

/**
 * Retorna a data atual em formato ISO string.
 */
function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

/**
 * Verifica se uma data está dentro de um intervalo (inclusivo).
 * @param date - Data a verificar
 * @param from - Início do intervalo (null = sem limite inferior)
 * @param until - Fim do intervalo (null = sem limite superior)
 */
function isWithinRange(date: Date, from: Date | null, until: Date | null): boolean {
  if (from && isBefore(date, from)) {
    return false;
  }
  if (until && isAfter(date, until)) {
    return false;
  }
  return true;
}

export {
  parseIsoDate,
  isBefore,
  isAfter,
  isBeforeOrEqual,
  isAfterOrEqual,
  nowIso,
  isWithinRange
};
