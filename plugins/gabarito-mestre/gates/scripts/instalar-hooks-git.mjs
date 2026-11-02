#!/usr/bin/env node
/**
 * Instala o versionamento (R20) como hooks do próprio git: `commit-msg` (confere a mensagem) e `pre-push`
 * (confere o nome de cada branch de destino). Antes era um guard PreToolUse que lia o texto do comando Bash —
 * frágil por construção (`git commit -am`, heredoc, `-F`); o git entrega a mensagem pronta, sem parsing de shell.
 *
 * INVARIANTE: este instalador escreve em arquivo de TERCEIRO (o hook do usuário, do husky, de outra ferramenta).
 * Nunca sobrescreve e, EM DÚVIDA, NÃO TOCA: devolve `acao: 'recusado'` com `motivo` e a `linha` para o usuário
 * colar à mão. Recusa quando:
 *   · o hook existente não é shell (shebang python/node/…) — um bloco sh quebraria todo commit;
 *   · o hook tem NUL ou não é UTF-8 (binário, latin-1) — reescrever corromperia;
 *   · o hook é symlink, ou não tem permissão de execução (o git o ignoraria: "instalado" mentiria);
 *   · o bloco tem início sem fim (edição manual/versão futura);
 *   · o diretório efetivo de hooks fica fora do repo (toplevel e git-common-dir) ou vem de config global/system.
 *
 * DESTINO: `git rev-parse --git-path hooks` (respeita config efetiva, `~`, relativo, worktree, submódulo).
 * Se esse caminho é `.husky/_` (husky 9), os hooks do usuário moram em `.husky/` e é lá que o bloco entra.
 *
 * BLOCO: entre `# >>> gabarito-mestre` e `# <<< gabarito-mestre`, LOGO DEPOIS do shebang (para um `exit 0` do hook
 * antigo não calar o nosso). Idempotente: bloco completo presente → 'mantido', arquivo intocado. O hook chama
 * `tools/gabarito-gates/scripts/versionamento-check.mjs`; só o exit 2 (reprovado) bloqueia — outro código, node ou
 * script ausente viram aviso em stderr e o commit/push segue (fail-open declarado, G9).
 *
 * USO   node instalar-hooks-git.mjs [raiz-do-repo]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, realpathSync, lstatSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { git, raizDoRepo } from '../lib/git.mjs';
import { ehEntrypoint } from '../lib/cli.mjs';

export const MARCA_INICIO = '# >>> gabarito-mestre';
export const MARCA_FIM = '# <<< gabarito-mestre';

const PRELUDIO = [
  'gm_raiz=$(git rev-parse --show-toplevel 2>/dev/null) || gm_raiz=.',
  'gm_check="$gm_raiz/tools/gabarito-gates/scripts/versionamento-check.mjs"',
  'if command -v node >/dev/null 2>&1 && [ -f "$gm_check" ]; then',
];
const aposCheck = (flag) => [
  `  gm_rc=0; node "$gm_check" ${flag} || gm_rc=$?`,
  '  if [ "$gm_rc" -eq 2 ]; then exit 1; fi',
  '  if [ "$gm_rc" -ne 0 ]; then echo "gabarito-mestre: versionamento-check falhou (código $gm_rc) — R20 não conferida (fail-open declarado, G9)" >&2; fi',
];
const FALLBACK = [
  'else',
  '  echo "gabarito-mestre: node ou tools/gabarito-gates ausente — R20 não conferida (fail-open declarado, G9)" >&2',
  'fi',
];

const CORPO = {
  'commit-msg': [...PRELUDIO, ...aposCheck('--msg "$1"'), ...FALLBACK],
  'pre-push': [...PRELUDIO, ...aposCheck('--pre-push'), ...FALLBACK],
};

/** A linha para o usuário colar à mão quando o instalador recusa. */
const LINHA = {
  'commit-msg': 'node "$(git rev-parse --show-toplevel)/tools/gabarito-gates/scripts/versionamento-check.mjs" --msg "$1" || [ $? -ne 2 ] || exit 1',
  'pre-push': 'node "$(git rev-parse --show-toplevel)/tools/gabarito-gates/scripts/versionamento-check.mjs" --pre-push || [ $? -ne 2 ] || exit 1',
};

function bloco(hook) {
  return [MARCA_INICIO, '# R20 — versionamento é gate (gerado pelo gabarito-mestre; edite fora destes marcadores)', ...CORPO[hook], MARCA_FIM, ''].join('\n');
}

const SHELL_OK = /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?)?(?:\S*\/)?(?:sh|bash|zsh|dash)(?:\s.*)?$/;

/** realpath do ancestral existente mais próximo + o resto (o diretório de hooks pode ainda não existir). */
function realpathAteExistente(p) {
  const resto = [];
  let cur = resolve(p);
  while (!existsSync(cur)) {
    resto.unshift(basename(cur));
    const pai = dirname(cur);
    if (pai === cur) break;
    cur = pai;
  }
  return join(realpathSync(cur), ...resto);
}
const dentro = (p, base) => {
  const r = realpathAteExistente(p);
  const b = realpathSync(base);
  return r === b || r.startsWith(b + sep);
};

/** Onde os hooks moram: { destino, dir } ou { recusa: motivo }. */
export function localizarDestino(raiz) {
  const topo = realpathSync(git(['rev-parse', '--show-toplevel'], raiz));
  if (topo !== realpathSync(raiz)) throw new Error(`${raiz} não é a raiz de um repositório git`);
  let escopo = '';
  try {
    escopo = git(['config', '--show-scope', '--get', 'core.hooksPath'], raiz).split(/\s/)[0];
  } catch {
    escopo = '';
  }
  if (escopo && escopo !== 'local' && escopo !== 'worktree') {
    return { recusa: `core.hooksPath vem da config ${escopo}, compartilhada com outros repositórios — não escrevo ali` };
  }
  const efetivo = resolve(raiz, git(['rev-parse', '--git-path', 'hooks'], raiz));
  const comum = resolve(raiz, git(['rev-parse', '--git-common-dir'], raiz));
  if (!dentro(efetivo, topo) && !dentro(efetivo, comum)) {
    return { recusa: `o diretório de hooks (${efetivo}) fica fora do repositório` };
  }
  const husky = join(topo, '.husky');
  if (existsSync(husky) && realpathAteExistente(efetivo) === realpathAteExistente(join(husky, '_'))) {
    return { destino: '.husky', dir: husky };
  }
  return { destino: escopo ? 'hooksPath' : '.git/hooks', dir: efetivo };
}

const recusa = (hook, motivo) => ({ acao: 'recusado', motivo: `${hook}: ${motivo}`, linha: LINHA[hook] });

function utf8Valido(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function instalarUm(arquivo, hook, ehHusky) {
  const novo = bloco(hook);
  let st = null;
  try {
    st = lstatSync(arquivo);
  } catch {
    st = null;
  }
  if (!st) {
    mkdirSync(dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, `#!/usr/bin/env sh\n${novo}`);
    chmodSync(arquivo, 0o755);
    return { acao: 'criado' };
  }
  if (st.isSymbolicLink()) return recusa(hook, `${arquivo} é um symlink — escrever nele alteraria o alvo`);
  if (!st.isFile()) return recusa(hook, `${arquivo} não é arquivo regular`);
  const buf = readFileSync(arquivo);
  if (buf.includes(0) || !utf8Valido(buf)) return recusa(hook, `${arquivo} é binário ou não é UTF-8 — não reescrevo`);
  const texto = buf.toString('utf8');
  const ini = texto.indexOf(MARCA_INICIO);
  const fim = texto.indexOf(MARCA_FIM);
  if (ini !== -1 && fim > ini) return { acao: 'mantido' };
  if (ini !== -1 || fim !== -1) return recusa(hook, `${arquivo} tem o marcador do gabarito-mestre incompleto (início sem fim)`);
  const primeira = texto.split('\n', 1)[0];
  const temShebang = primeira.startsWith('#!');
  if (temShebang && (primeira.endsWith('\r') || !SHELL_OK.test(primeira))) {
    return recusa(hook, `${arquivo} não é shell (${primeira.trim()}) — o bloco é sh`);
  }
  if (!ehHusky && !(statSync(arquivo).mode & 0o111)) {
    return recusa(hook, `${arquivo} sem permissão de execução — o git o ignora (chmod +x e rode de novo)`);
  }
  // Depois do shebang (se houver); sem shebang, no topo. Bytes originais preservados, sem decodificar.
  const nl = buf.indexOf(0x0a);
  const corte = temShebang ? (nl === -1 ? buf.length : nl + 1) : 0;
  const cabeca = buf.subarray(0, corte);
  const quebra = cabeca.length && cabeca[cabeca.length - 1] !== 0x0a ? Buffer.from('\n') : Buffer.alloc(0);
  writeFileSync(arquivo, Buffer.concat([cabeca, quebra, Buffer.from(novo), buf.subarray(corte)]));
  return { acao: 'anexado' };
}

/**
 * @returns {{destino: '.husky'|'hooksPath'|'.git/hooks'|null, acao: 'criado'|'anexado'|'mantido'|'recusado',
 *            motivo?: string, linha?: string, hooks: Record<string, object>}}
 *   `acao` agrega os hooks: algum recusado → 'recusado' (os demais seguem instalados; `hooks` detalha);
 *   tudo presente → 'mantido'; algum anexo → 'anexado'; senão 'criado'.
 */
export function instalarHooksGit(raizRepo) {
  const raiz = resolve(raizRepo);
  const loc = localizarDestino(raiz);
  if (loc.recusa) return { destino: null, acao: 'recusado', motivo: loc.recusa, linha: LINHA['commit-msg'], hooks: {} };
  const hooks = {};
  for (const hook of Object.keys(CORPO)) hooks[hook] = instalarUm(join(loc.dir, hook), hook, loc.destino === '.husky');
  const rs = Object.values(hooks);
  const recusados = rs.filter((h) => h.acao === 'recusado');
  if (recusados.length) {
    return { destino: loc.destino, acao: 'recusado', motivo: recusados.map((h) => h.motivo).join(' · '), linha: recusados[0].linha, hooks };
  }
  const acoes = rs.map((h) => h.acao);
  const acao = acoes.every((a) => a === 'mantido') ? 'mantido' : acoes.includes('anexado') ? 'anexado' : 'criado';
  return { destino: loc.destino, acao, hooks };
}

if (ehEntrypoint(import.meta.url)) {
  const raiz = process.argv[2] ? resolve(process.argv[2]) : raizDoRepo();
  try {
    const r = instalarHooksGit(raiz);
    if (r.acao === 'recusado') {
      console.log(`  AVISO: hooks git (R20) NÃO instalados por inteiro — ${r.motivo}`);
      console.log(`         Cole no hook (mantendo o seu), se quiser a checagem: ${r.linha}`);
    } else {
      console.log(`  hooks git (R20) ${r.acao} em ${r.destino}`);
    }
  } catch (e) {
    // Fora de repo git, fora da raiz ou git ausente: não é erro do instalador do harness — avisa e segue.
    console.log(`  AVISO: hooks git não instalados (${String(e?.message ?? e).split('\n')[0]})`);
  }
}
