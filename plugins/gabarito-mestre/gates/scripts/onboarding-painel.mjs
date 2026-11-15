/**
 * `onboarding.mjs painel --root <d> [--local lateral|acima]` (GM-14 T21, REQ-ONB-2, D-P2): oferta do local do painel e gravação.
 *
 * Sem `--local` só LÊ (`ofertaLocal`). Com `--local` (a escolha do dono) `gravarLocal` mexe em UM arquivo, `harness.config.json`
 * da raiz, por merge de chave: só `painel.local`; as demais chaves e a indentação do arquivo ficam como estavam, tmp + rename.
 * Ausente ≠ corrompido: config ausente (ou vazia) oferece e grava; config que não é um objeto JSON, ou `painel` que não é objeto,
 * ⇒ `Falha('config_corrompido')` e NADA gravado. Falha nunca vira sucesso.
 * Texto da oferta: o simples de spec:70 (decisão Sombra 91a18fea); nenhuma palavra do glossário proibido.
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Falha } from './onboarding-foco.mjs';

const CONFIG = 'harness.config.json';
const LOCAIS = ['lateral', 'acima'];
const PADRAO = 'lateral';
const ROTULO = { lateral: 'ao lado da conversa (padrão)', acima: 'acima da linha de digitar' };
const TEXTO = 'Onde quer o painel? Pode ser ao lado da conversa (padrão; a plataforma só o põe sozinho com 144 colunas ou mais (ao lado da conversa em tela cheia, acima da linha de digitar nas outras); abaixo disso o painel avisa e ele abre quando você pede /gabarito painel, em qualquer largura) ou acima da linha de digitar.';
const NOME_FRASE = { lateral: 'ao lado da conversa', acima: 'acima da linha de digitar' };

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `{ obj, texto }` (ausente/vazio ⇒ `obj: {}`, `texto: ''`) | `{ erro }`. Só JSON estrito, objeto simples; `painel` presente tem de ser objeto. */
function lerConfig(caminho) {
  let texto;
  try {
    texto = readFileSync(caminho, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { obj: {}, texto: '' };
    return { erro: String(e.message).split('\n')[0] };
  }
  if (texto.trim() === '') return { obj: {}, texto: '' };
  let obj;
  try {
    obj = JSON.parse(texto);
  } catch (e) {
    return { erro: String(e.message).split('\n')[0] };
  }
  if (!ehObjeto(obj)) return { erro: 'não é um objeto JSON' };
  if (Object.hasOwn(obj, 'painel') && !ehObjeto(obj.painel)) return { erro: '`painel` não é um objeto' };
  return { obj, texto };
}

function indentacaoDe(texto) {
  const m = /\n([ \t]+)\S/.exec(texto ?? '');
  return m ? m[1] : '  ';
}

/** Só lê. → `{ oferecer, texto, opcoes: [{valor, rotulo}], default, motivo?, atual? }`. */
export function ofertaLocal(raiz) {
  const base = { texto: TEXTO, opcoes: LOCAIS.map((valor) => ({ valor, rotulo: ROTULO[valor] })), default: PADRAO };
  const c = lerConfig(join(resolve(raiz), CONFIG));
  if (c.erro !== undefined) return { oferecer: false, ...base, motivo: 'config_corrompido' };
  const atual = c.obj.painel?.local;
  if (LOCAIS.includes(atual)) return { oferecer: false, ...base, motivo: 'ja_gravado', atual };
  return { oferecer: true, ...base };
}

/** → `{ ok, local, mudou, frase, comoTrocar }`. Valor fora da lista ⇒ `Falha('local_invalido')`; config corrompido ⇒ `Falha('config_corrompido')`. */
export function gravarLocal(raiz, local) {
  if (!LOCAIS.includes(local)) throw new Falha('local_invalido', `local do painel precisa ser ${LOCAIS.join(' ou ')}; nada foi gravado`);
  const caminho = join(resolve(raiz), CONFIG);
  const c = lerConfig(caminho);
  if (c.erro !== undefined) throw new Falha('config_corrompido', `${CONFIG} não é um JSON de objeto válido (${c.erro}); nada foi gravado. Corrija o arquivo e tente de novo`);
  const mudou = c.obj.painel?.local !== local;
  if (mudou) {
    const novo = { ...c.obj, painel: { ...(c.obj.painel ?? {}), local } };
    const tmp = `${caminho}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify(novo, null, indentacaoDe(c.texto))}\n`);
      renameSync(tmp, caminho);
    } catch (e) {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* o erro que importa é o da escrita */ }
      throw e;
    }
  }
  const comoTrocar = 'Para trocar depois, peça "/gabarito painel".';
  return { ok: true, local, mudou, frase: `${mudou ? 'Pronto' : 'Já estava assim'}: o painel fica ${NOME_FRASE[local]}. ${comoTrocar}`, comoTrocar };
}
