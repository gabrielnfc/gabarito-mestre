/**
 * REGRA DE LINT — `no-unfiltered-mass-mutation`.
 *
 * Barreira ESTÁTICA da R2/G3. A barreira de runtime é `massMutationGuard()`.
 * Nenhuma das duas sozinha basta:
 *   - a estática não enxerga valor que vem de variável (`where: { id: talvezUndefined }`);
 *   - a de runtime só age quando o código já rodou, e no ambiente errado isso é tarde.
 * Duas barreiras independentes é o desenho, não redundância.
 *
 * O que ela pega, com certeza e sem tipo:
 *   1. `deleteMany()` / `updateMany()` sem argumento nenhum
 *   2. `where: {}` literal vazio
 *   3. `where: { x: undefined }` — `undefined` escrito à mão
 *   4. `where` recebendo objeto vindo de spread apenas (`{ ...filtro }`), que não dá
 *      para verificar estaticamente — é aviso, não erro
 *
 * O que ela NÃO pega, e está declarado: valor `undefined` vindo de variável, que é
 * exatamente o incidente original. Por isso o runtime é obrigatório.
 *
 * USO (flat config)
 *   import harness from './eslint/no-unfiltered-mass-mutation.js';
 *   export default [{ plugins: { harness: { rules: { 'no-unfiltered-mass-mutation': harness } } },
 *                     rules: { 'harness/no-unfiltered-mass-mutation': 'error' } }];
 */

const MASS_OPS = new Set(['deleteMany', 'updateMany', 'updateManyAndReturn']);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Recusa mutação em massa sem filtro efetivo. Regra R2: nenhum delete sem permissão explícita.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          escapeHatch: { type: 'string' },
          operations: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      semArgumento:
        '[R2] `{{op}}()` sem argumento alcança a TABELA INTEIRA. Passe um filtro que restrinja, ou declare a intenção com `{{hatch}}("<motivo>", args)`.',
      whereVazio:
        '[R2] `where: {}` não restringe nada — `{{op}}` alcançaria a tabela inteira. Se for intencional, use `{{hatch}}("<motivo>", args)`.',
      undefinedLiteral:
        '[R2] `{{prop}}: undefined` dentro de `where` é DESCARTADO em silêncio pelo ORM — o filtro fica mais largo do que parece. Foi assim que uma base inteira foi apagada.',
      spreadOpaco:
        '[R2] `where` montado só por spread não é verificável estaticamente. Garanta a guarda de runtime, ou declare com `{{hatch}}("<motivo>", args)`.',
    },
  },

  create(context) {
    const opts = context.options[0] ?? {};
    const hatch = opts.escapeHatch ?? 'allowFullScan';
    const ops = new Set(opts.operations ?? [...MASS_OPS]);

    const nomeDaChamada = (node) =>
      node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier'
        ? node.callee.property.name
        : null;

    const envoltoNoHatch = (node) => {
      let pai = node.parent;
      while (pai) {
        if (
          pai.type === 'CallExpression' &&
          ((pai.callee.type === 'Identifier' && pai.callee.name === hatch) ||
            (pai.callee.type === 'MemberExpression' &&
              pai.callee.property.type === 'Identifier' &&
              pai.callee.property.name === hatch))
        ) {
          return true;
        }
        pai = pai.parent;
      }
      return false;
    };

    const ehHatch = (arg) =>
      arg &&
      arg.type === 'CallExpression' &&
      ((arg.callee.type === 'Identifier' && arg.callee.name === hatch) ||
        (arg.callee.type === 'MemberExpression' &&
          arg.callee.property.type === 'Identifier' &&
          arg.callee.property.name === hatch));

    function checarWhere(whereNode, op, node) {
      if (whereNode.type !== 'ObjectExpression') {
        if (whereNode.type === 'Identifier') {
          context.report({ node: whereNode, messageId: 'spreadOpaco', data: { hatch } });
        }
        return;
      }

      const props = whereNode.properties;
      if (props.length === 0) {
        context.report({ node: whereNode, messageId: 'whereVazio', data: { op, hatch } });
        return;
      }

      const soSpread = props.every((p) => p.type === 'SpreadElement');
      if (soSpread) {
        context.report({ node: whereNode, messageId: 'spreadOpaco', data: { hatch } });
      }

      const visitar = (obj) => {
        for (const p of obj.properties) {
          if (p.type === 'SpreadElement') continue;
          const valor = p.value;
          if (valor.type === 'Identifier' && valor.name === 'undefined') {
            context.report({
              node: p,
              messageId: 'undefinedLiteral',
              data: { prop: p.key.name ?? p.key.value ?? '?' },
            });
          } else if (valor.type === 'ObjectExpression') {
            visitar(valor);
          } else if (valor.type === 'ArrayExpression') {
            for (const el of valor.elements) if (el && el.type === 'ObjectExpression') visitar(el);
          }
        }
      };
      visitar(whereNode);
      void node;
    }

    return {
      CallExpression(node) {
        const op = nomeDaChamada(node);
        if (!op || !ops.has(op)) return;
        if (envoltoNoHatch(node)) return;

        const [arg] = node.arguments;

        if (arg === undefined) {
          context.report({ node, messageId: 'semArgumento', data: { op, hatch } });
          return;
        }
        if (ehHatch(arg)) return;
        if (arg.type !== 'ObjectExpression') return;

        const where = arg.properties.find(
          (p) => p.type === 'Property' && (p.key.name === 'where' || p.key.value === 'where'),
        );

        if (!where) {
          context.report({ node: arg, messageId: 'whereVazio', data: { op, hatch } });
          return;
        }
        checarWhere(where.value, op, node);
      },
    };
  },
};
