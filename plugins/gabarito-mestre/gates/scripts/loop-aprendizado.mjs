/**
 * Subcomandos do aprendizado, do pouso e do registro de `loop.mjs` (GM-13). T1: só a fiação; cada um responde
 * `nao_implementado` (rc 1) sem gravar nada, até a task dona (T8 `aprendizado`/`aprendizados`, T11 `registro`, T12 `pousar`).
 * As dependências vêm injetadas por `loop.mjs` (`{ c, plano, gravar, lerDiarioEstrito, Falha, git }`): este módulo não importa `loop.mjs`.
 */

const stub = (nome, task) => (deps) => {
  throw new deps.Falha('nao_implementado', `loop.mjs ${nome}: ainda não implementado (${task} da E5a); nada foi gravado`);
};

export const aprendizado = stub('aprendizado', 'T8');
export const aprendizados = stub('aprendizados', 'T8');
export const pousar = stub('pousar', 'T12');
export const registro = stub('registro', 'T11');
