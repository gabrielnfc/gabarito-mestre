/**
 * `onboarding.mjs foco --root <d> [--sim]` (GM-14, REQ-ONB-2): oferta do modo foco e gravação com ok.
 *
 * Sem `--sim` só LÊ (`ofertaFoco`). Com `--sim` (o ok do dono) `gravarFoco` mexe em UM arquivo, `.claude/settings.local.json`
 * (pessoal e local, nunca `settings.json`), por merge de chave: só `viewMode: "focus"` e, como o S1b(ii) REFUTOU que o foco
 * apareça sem tela cheia, `tui: "fullscreen"` junto. Antes de gravar, `git check-ignore -q`: não ignorado ⇒ acrescenta a linha
 * ao `.gitignore`. Falha fecha: settings ilegível (comentário, vírgula final, não objeto) ou `check-ignore` que não responde
 * 0 nem 1 (fora de repo é 128, `git` ausente, timeout) ⇒ `Falha` e NADA gravado, nem o `.gitignore`.
 * Ordem das escritas: `.gitignore` primeiro (o arquivo pessoal nunca fica sem ignore), settings por último, tmp + rename.
 * Limite declarado: só lê o settings local do projeto para saber se "já está em foco"; `settings.json` do projeto e o do
 * usuário não são consultados.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** S1b(ii) REFUTADA (t0a.md): com `tui` padrão o foco não aparece; o "sim" grava `tui: "fullscreen"` junto. */
export const FOCO_EXIGE_TELA_CHEIA = true;

const SETTINGS = '.claude/settings.local.json';
const TIMEOUT_CHECK_IGNORE_MS = 5000;
const OFERTA = 'Quer o chat mais limpo, só com a sua pergunta, um resumo do que a IA fez e a resposta?';
const AVISO_JANELA = ' (o Claude passa a ocupar a janela inteira)';
const OPCOES = ['sim', 'não, obrigado'];
const PADRAO = 'não, obrigado';

/** Falha com código: o despachante a devolve como `{ok:false, erro, ...}` e rc 1. */
export class Falha extends Error {
  constructor(erro, mensagem) {
    super(mensagem);
    this.erro = erro;
  }
}

/** `{ ausente: true }` | `{ obj, texto }` | `{ erro }`. Vazio ⇒ `{}` (nada a perder). Só JSON estrito, objeto simples. */
function lerSettings(caminho) {
  let texto;
  try {
    texto = readFileSync(caminho, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { ausente: true };
    return { erro: String(e.message).split('\n')[0] };
  }
  if (texto.trim() === '') return { obj: {}, texto };
  try {
    const obj = JSON.parse(texto);
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { erro: 'não é um objeto JSON' };
    return { obj, texto };
  } catch (e) {
    return { erro: String(e.message).split('\n')[0] };
  }
}

const textoOferta = (exigeTelaCheia) => OFERTA + (exigeTelaCheia ? AVISO_JANELA : '');

/** Só lê. → `{ oferecer, texto, opcoes, default, motivo? }`; já em foco ou settings ilegível ⇒ `oferecer:false` com `motivo`. */
export function ofertaFoco(raiz, { exigeTelaCheia = FOCO_EXIGE_TELA_CHEIA } = {}) {
  const base = { texto: textoOferta(exigeTelaCheia), opcoes: [...OPCOES], default: PADRAO };
  const s = lerSettings(join(resolve(raiz), SETTINGS));
  if (s.erro !== undefined) return { oferecer: false, ...base, motivo: 'settings_corrompido' };
  if (s.obj?.viewMode === 'focus') return { oferecer: false, ...base, motivo: 'ja_em_foco' };
  return { oferecer: true, ...base };
}

/** Indentação do arquivo (tab ou espaços da 1ª linha indentada); sem indentação ⇒ 2 espaços. */
function indentacaoDe(texto) {
  const m = /\n([ \t]+)\S/.exec(texto ?? '');
  return m ? m[1] : '  ';
}

function voltar(chaves, anteriores, exigeTelaCheia) {
  const passos = chaves.map((c) => (anteriores[c] === undefined ? `apague "${c}"` : `volte "${c}" para ${JSON.stringify(anteriores[c])}`));
  if (passos.length === 0) return `O foco já estava ligado e nada mudou. Para desligar, edite ${SETTINGS} e apague "viewMode"${exigeTelaCheia ? ' e "tui"' : ''}.`;
  return `Para voltar ao chat de antes, edite ${SETTINGS}: ${passos.join(' e ')}.`;
}

/** Acrescenta a linha ao `.gitignore` (cria se falta; fim de linha do arquivo; linha própria mesmo sem `\n` final). */
function acrescentarIgnore(raiz) {
  const caminho = join(raiz, '.gitignore');
  let texto = '';
  try {
    texto = readFileSync(caminho, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Falha('gitignore_ilegivel', `.gitignore ilegível (${String(e.message).split('\n')[0]}); nada foi gravado`);
  }
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  const separador = texto === '' || texto.endsWith('\n') ? '' : eol;
  writeFileSync(caminho, `${texto}${separador}${SETTINGS}${eol}`);
}

function escreverSettings(caminho, conteudo) {
  mkdirSync(dirname(caminho), { recursive: true });
  const tmp = `${caminho}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, conteudo);
    renameSync(tmp, caminho);
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* o erro que importa é o da escrita */ }
    throw e;
  }
}

/**
 * Só com o ok do dono (CLI `--sim`). `rodar(cmd, args, { timeoutMs })` → `{ rc, stdout, stderr, motivo }` é injetado.
 * → `{ ok, chaves, gitignore: 'ja_ignorado' | 'acrescentado', frase, comoVoltar }`; `chaves` = só as que mudaram.
 */
export function gravarFoco(raiz, { rodar, exigeTelaCheia = FOCO_EXIGE_TELA_CHEIA } = {}) {
  if (typeof rodar !== 'function') throw new Falha('sem_executor', 'gravarFoco exige o executor de processos (rodar); nada foi gravado');
  const base = resolve(raiz);
  const caminho = join(base, SETTINGS);
  const s = lerSettings(caminho);
  if (s.erro !== undefined) throw new Falha('settings_corrompido', `${SETTINGS} não é um JSON de objeto válido (${s.erro}); nada foi gravado. Corrija ou apague o arquivo e tente de novo`);
  const atual = s.obj ?? {};

  const ig = rodar('git', ['-C', base, 'check-ignore', '-q', '--', SETTINGS], { timeoutMs: TIMEOUT_CHECK_IGNORE_MS });
  if (!ig || ig.motivo || (ig.rc !== 0 && ig.rc !== 1)) {
    throw new Falha('check_ignore_falhou', `não consegui conferir se ${SETTINGS} é ignorado pelo git (${ig?.motivo ?? `código ${ig?.rc}`}); nada foi gravado`);
  }
  const jaIgnorado = ig.rc === 0;
  if (!jaIgnorado) acrescentarIgnore(base);

  const desejado = { viewMode: 'focus', ...(exigeTelaCheia ? { tui: 'fullscreen' } : {}) };
  const chaves = Object.keys(desejado).filter((c) => atual[c] !== desejado[c]);
  const anteriores = Object.fromEntries(chaves.map((c) => [c, atual[c]]));
  if (chaves.length > 0) {
    const novo = { ...atual };
    for (const c of chaves) novo[c] = desejado[c];
    escreverSettings(caminho, `${JSON.stringify(novo, null, indentacaoDe(s.texto))}\n`);
  }

  const partes = [chaves.length > 0 ? 'Pronto: o chat agora fica mais limpo, só com a sua pergunta, um resumo do que a IA fez e a resposta.' : 'O chat já estava no modo mais limpo; nada mudou.'];
  if (exigeTelaCheia) partes.push('O Claude passa a ocupar a janela inteira.');
  if (!jaIgnorado) partes.push(`Como ${SETTINGS} é só seu, acrescentei esse arquivo ao .gitignore para ele não ir ao repositório.`);
  return { ok: true, chaves, gitignore: jaIgnorado ? 'ja_ignorado' : 'acrescentado', frase: partes.join(' '), comoVoltar: voltar(chaves, anteriores, exigeTelaCheia) };
}
