/**
 * GATE G3 — guarda de mutação em massa.
 *
 * Implementa a regra R2 (nenhum delete sem permissão explícita) como código, para
 * que ela pare de depender de alguém lembrar.
 *
 * INCIDENTE QUE ESTA GUARDA IMPEDE
 * Um teardown de teste com `where: { tenantId }`, onde `tenantId` chegou `undefined`,
 * apagou uma base inteira sem backup. O ORM **descarta chave `undefined` em silêncio**,
 * então `{ tenantId: undefined }` virou `{}` — e `{}` é "todas as linhas".
 *
 * A REGRA QUE FECHA A CLASSE DE BUG
 * Recusar (i) filtro sem nenhuma condição efetiva E (ii) valor `undefined` em QUALQUER
 * profundidade do filtro, mesmo com outras condições presentes.
 * É a (ii) que importa: `{ tenantId: undefined, ativo: true }` parece filtrado e apaga
 * todos os ativos. Uma guarda que só olha "o objeto está vazio?" não pega esse caso.
 *
 * DEFESA EM PROFUNDIDADE
 * Esta guarda é a barreira de runtime. A barreira estática é a regra de lint
 * `no-unfiltered-mass-mutation`. Nenhuma das duas sozinha bastaria — a estática não
 * enxerga valor vindo de variável, e a de runtime só age quando o código já rodou.
 *
 * USO (Prisma)
 *   const prisma = new PrismaClient().$extends(massMutationGuard());
 *
 * ESCAPE HATCH — nominal, grepável, com motivo obrigatório:
 *   await prisma.log.deleteMany(allowFullScan('expurgo mensal de logs (RFC-42)', {}));
 */

/** Marca de intenção explícita. Symbol para não colidir com nenhum campo do ORM. */
const FULL_SCAN = Symbol.for('harness.allowFullScan');

export interface MassMutationGuardOptions {
  /** Operações guardadas. Operação de linha única já exige chave única no próprio ORM. */
  operations?: string[];
  /** Para onde vai o aviso do escape hatch. Default: console.warn. */
  warn?: (message: string) => void;
}

const DEFAULT_OPERATIONS = ['deleteMany', 'updateMany', 'updateManyAndReturn'];

/**
 * Autoriza explicitamente uma mutação sem filtro. O motivo é OBRIGATÓRIO e não pode
 * ser vazio: um escape hatch sem motivo vira o caminho padrão em duas semanas.
 */
export function allowFullScan<T extends object>(motivo: string, args: T): T {
  if (typeof motivo !== 'string' || motivo.trim().length === 0) {
    throw new Error(
      'allowFullScan exige um motivo não-vazio. Escreva por que esta mutação sem filtro é intencional.',
    );
  }
  return Object.assign({}, args, { [FULL_SCAN]: motivo }) as T;
}

/** `true` só para objeto literal — instância de classe (Date, Decimal, Buffer) é valor, não filtro. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Um filtro é EFETIVO quando restringe de fato.
 *
 * - chave com valor `undefined`  → não restringe (o ORM a descarta)
 * - `AND` / `NOT`                → basta um ramo efetivo
 * - `OR`                         → exige TODOS os ramos efetivos; um ramo frouxo
 *                                   degenera a disjunção inteira para "tudo".
 *                                   `OR: []` não casa nada, logo é restritivo.
 * - objeto aninhado              → recursa
 * - qualquer outro valor         → restringe
 */
export function hasEffectiveFilter(where: unknown): boolean {
  if (where === undefined || where === null) return false;
  if (!isPlainObject(where)) return true;

  const entries = Object.entries(where);
  if (entries.length === 0) return false;

  for (const [key, value] of entries) {
    if (value === undefined) continue;

    if (key === 'OR') {
      if (!Array.isArray(value)) {
        if (hasEffectiveFilter(value)) return true;
        continue;
      }
      if (value.length === 0) return true; // OR vazio não casa nada
      if (value.every((branch) => hasEffectiveFilter(branch))) return true;
      continue;
    }

    if (key === 'AND' || key === 'NOT') {
      if (Array.isArray(value)) {
        if (value.some((branch) => hasEffectiveFilter(branch))) return true;
        continue;
      }
      if (hasEffectiveFilter(value)) return true;
      continue;
    }

    if (isPlainObject(value)) {
      if (hasEffectiveFilter(value)) return true;
      continue;
    }

    return true;
  }

  return false;
}

/** Percorre o filtro inteiro procurando `undefined` explícito, em qualquer profundidade. */
export function findUndefinedPath(value: unknown, path: string[] = []): string | null {
  if (value === undefined) return path.join('.') || '<raiz>';
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findUndefinedPath(value[i], [...path, String(i)]);
      if (found) return found;
    }
    return null;
  }
  if (!isPlainObject(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const found = findUndefinedPath(child, [...path, key]);
    if (found) return found;
  }
  return null;
}

export class MassMutationBlocked extends Error {
  readonly model: string;
  readonly operation: string;
  readonly reason: string;

  constructor(model: string, operation: string, reason: string) {
    super(
      `[G3] ${operation} em "${model}" recusado: ${reason}. ` +
        `Filtro sem condição efetiva apaga ou altera a TABELA INTEIRA (regra R2). ` +
        `Se a mutação sem filtro for intencional, envolva os argumentos em ` +
        `allowFullScan('<motivo>', args) — o motivo fica no código e no log.`,
    );
    this.name = 'MassMutationBlocked';
    this.model = model;
    this.operation = operation;
    this.reason = reason;
  }
}

/**
 * Extension do Prisma. Estruturalmente tipada de propósito: não importa tipos do
 * Prisma, então este arquivo pode ser copiado para qualquer repo sem arrastar
 * dependência de build.
 */
export function massMutationGuard(options: MassMutationGuardOptions = {}) {
  const guarded = new Set(options.operations ?? DEFAULT_OPERATIONS);
  const warn = options.warn ?? ((m: string) => console.warn(m));

  return {
    name: 'harness-mass-mutation-guard',
    query: {
      $allOperations({
        model,
        operation,
        args,
        query,
      }: {
        model?: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => unknown;
      }) {
        if (!guarded.has(operation)) return query(args);

        const alvo = model ?? '<raw>';
        const bag = isPlainObject(args) ? args : {};
        const motivo = (bag as Record<PropertyKey, unknown>)[FULL_SCAN];

        if (typeof motivo === 'string') {
          warn(`[G3] full scan AUTORIZADO — ${operation} em "${alvo}": ${motivo}`);
          const limpo = { ...(bag as Record<string, unknown>) };
          delete (limpo as Record<PropertyKey, unknown>)[FULL_SCAN];
          return query(limpo);
        }

        const where = (bag as { where?: unknown }).where;

        // (ii) — a regra que fecha a classe de bug. Vem ANTES da (i) de propósito:
        // um filtro pode ter condições efetivas e ainda carregar um `undefined`
        // que silenciosamente alarga o alcance.
        const caminho = findUndefinedPath(where);
        if (caminho !== null) {
          throw new MassMutationBlocked(
            alvo,
            operation,
            `o filtro tem \`undefined\` em "${caminho}" — o ORM descarta essa chave em silêncio`,
          );
        }

        // (i)
        if (!hasEffectiveFilter(where)) {
          throw new MassMutationBlocked(alvo, operation, 'o filtro não restringe nenhuma linha');
        }

        return query(args);
      },
    },
  };
}
