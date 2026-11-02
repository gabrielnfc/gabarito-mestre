#!/usr/bin/env node
/**
 * Instala o versionamento (R20) como hooks do próprio git: `commit-msg` (confere a mensagem) e `pre-push`
 * (confere o nome da branch). Antes era um guard PreToolUse que lia o texto do comando Bash — frágil por
 * construção (`git commit -am`, heredoc, `-F`); o git entrega a mensagem pronta, sem parsing de shell.
 *
 * DESTINO (nesta ordem): `.husky/` se existir · `core.hooksPath` se configurado · `.git/hooks`
 * (`git rev-parse --git-path hooks`, que também vale para worktree).
 *
 * REGRAS: nunca sobrescreve — o bloco do gabarito fica entre `# >>> gabarito-mestre` e `# <<< gabarito-mestre`,
 * logo depois do shebang (antes do que já existia, para um `exit 0` do hook antigo não calar o nosso). Idempotente:
 * bloco já presente → 'mantido', arquivo intocado. O hook chama `tools/gabarito-gates/scripts/versionamento-check.mjs`
 * (onde o instalador do harness põe os gates); sem node ou sem o script, avisa em stderr e deixa passar
 * (fail-open declarado, G9 — nunca trava o commit por falta de ferramenta).
 *
 * USO   node instalar-hooks-git.mjs [raiz-do-repo]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { git, raizDoRepo } from '../lib/git.mjs';
import { ehEntrypoint } from '../lib/cli.mjs';

export const MARCA_INICIO = '# >>> gabarito-mestre';
export const MARCA_FIM = '# <<< gabarito-mestre';

const PRELUDIO = [
  'gm_raiz=$(git rev-parse --show-toplevel 2>/dev/null) || gm_raiz=.',
  'gm_check="$gm_raiz/tools/gabarito-gates/scripts/versionamento-check.mjs"',
  'if command -v node >/dev/null 2>&1 && [ -f "$gm_check" ]; then',
];
const FALLBACK = [
  'else',
  '  echo "gabarito-mestre: node ou tools/gabarito-gates ausente — R20 não conferida (fail-open declarado, G9)" >&2',
  'fi',
];

/** Corpo de cada hook, sem os marcadores. `$1` do commit-msg é o arquivo da mensagem. */
const CORPO = {
  'commit-msg': [...PRELUDIO, '  node "$gm_check" --msg "$1" || exit 1', ...FALLBACK],
  'pre-push': [...PRELUDIO, '  node "$gm_check" --so-branch || exit 1', ...FALLBACK],
};

function bloco(hook) {
  return [MARCA_INICIO, `# R20 — versionamento é gate (gerado pelo gabarito-mestre; edite fora destes marcadores)`, ...CORPO[hook], MARCA_FIM, ''].join('\n');
}

/** Onde os hooks moram neste repo: { destino, dir }. */
export function localizarDestino(raiz) {
  if (existsSync(join(raiz, '.husky'))) return { destino: '.husky', dir: join(raiz, '.husky') };
  let hp = '';
  try {
    hp = git(['config', '--get', 'core.hooksPath'], raiz);
  } catch {
    hp = '';
  }
  if (hp) return { destino: 'hooksPath', dir: isAbsolute(hp) ? hp : join(raiz, hp) };
  return { destino: '.git/hooks', dir: resolve(raiz, git(['rev-parse', '--git-path', 'hooks'], raiz)) };
}

function instalarUm(arquivo, hook) {
  const novo = bloco(hook);
  if (!existsSync(arquivo)) {
    mkdirSync(dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, `#!/usr/bin/env sh\n${novo}`);
    chmodSync(arquivo, 0o755);
    return 'criado';
  }
  const atual = readFileSync(arquivo, 'utf8');
  if (atual.includes(MARCA_INICIO)) return 'mantido';
  // Depois do shebang (se houver); sem shebang, no topo.
  const quebra = atual.startsWith('#!') ? atual.indexOf('\n') + 1 || atual.length : 0;
  const cabeca = atual.slice(0, quebra);
  const resto = atual.slice(quebra);
  writeFileSync(arquivo, `${cabeca}${cabeca && !cabeca.endsWith('\n') ? '\n' : ''}${novo}${resto}`);
  return 'anexado';
}

/**
 * @returns {{destino: '.husky'|'hooksPath'|'.git/hooks', acao: 'criado'|'anexado'|'mantido'}}
 *   acao agrega os dois hooks: tudo já presente → 'mantido'; só arquivos novos → 'criado'; qualquer anexo → 'anexado'.
 */
export function instalarHooksGit(raizRepo) {
  const raiz = resolve(raizRepo);
  // Só na RAIZ de um repo: um diretório solto dentro de outro repo não pode gravar hook no repo de fora.
  if (realpathSync(git(['rev-parse', '--show-toplevel'], raiz)) !== realpathSync(raiz)) throw new Error(`${raiz} não é a raiz de um repositório git`);
  const { destino, dir } = localizarDestino(raiz);
  const acoes = Object.keys(CORPO).map((hook) => instalarUm(join(dir, hook), hook));
  const acao = acoes.every((a) => a === 'mantido') ? 'mantido' : acoes.includes('anexado') ? 'anexado' : 'criado';
  return { destino, acao };
}

if (ehEntrypoint(import.meta.url)) {
  const raiz = process.argv[2] ? resolve(process.argv[2]) : raizDoRepo();
  try {
    const r = instalarHooksGit(raiz);
    console.log(`  hooks git (R20) ${r.acao} em ${r.destino}`);
  } catch (e) {
    // Fora de repo git ou git ausente: não é erro do instalador do harness — avisa e segue.
    console.error(`  AVISO: hooks git não instalados (${String(e?.message ?? e).split('\n')[0]})`);
  }
}
