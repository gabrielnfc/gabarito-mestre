/**
 * T14 (GM-13, REQ-ONB-1): a skill `gabarito-instalar` em uma etapa só (sem fases) e `trocar.md`.
 *
 * Os testes de texto são funções puras `violacoes(texto) -> string[]`, rodadas (i) no SKILL.md e no trocar.md REAIS
 * (esperado `[]`) e (ii) em texto plantado, um por cláusula (esperado a violação NOMEADA). Cláusula negativa sem caso
 * plantado seria falha de P15. Âncoras por seção (`## Fluxo`), nunca o arquivo inteiro; busca de "fase" sem caixa.
 *
 * P9: `skill-exemplo-respostas-aceito-pelo-gravar` extrai o JSON de exemplo da skill e o passa pelo `gravar` REAL
 * (repo git em mkdtemp, `claude` falso), em dry-run.
 *
 * MUTAÇÕES PRESCRITAS (JSON em .superpowers/sdd/2026-11-10-e5-fluxo/task-14-mut.json):
 *  M-ONB6   a skill imprime comando para o usuário colar          => skill-sem-comando-para-colar
 *  M-ONB14  exemplo com "autonomia": "não"                         => skill-exemplo-respostas-aceito-pelo-gravar
 *  M-ONB15  exemplo sem `_previa`                                  => skill-exemplo-respostas-aceito-pelo-gravar
 *  M-ONB16  `--root .` no lugar da raiz do git                     => skill-raiz-do-git
 *  M-ONB17  onboarding.mjs de tools/ no lugar do do plugin         => skill-onboarding-do-plugin
 *  M-ONB18  tira a cláusula headless => --dry-run                  => skill-headless-dry-run
 *  M-ONB19  `--set` em prosa fora de bloco bash em trocar.md       => skill-sem-comando-para-colar
 *  M-ONB20  tira o teto de 2 voltas do `deteccao_mudou`            => skill-deteccao-mudou-teto
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { ORDEM_ITENS, IDS_FIXAS, coletarFatos, detectar, perguntas, gravar, rodarReal } from '../scripts/onboarding.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(AQUI, '..', '..');
const SKILL = readFileSync(join(PLUGIN, 'skills', 'gabarito-instalar', 'SKILL.md'), 'utf8');
const TROCAR = readFileSync(join(PLUGIN, 'skills', 'gabarito-instalar', 'trocar.md'), 'utf8');
const MARCADOR_TIM1 = '(gabarito-instalar, fase 2). Uma linha por área:'; // byte a byte: reconhece o CODEOWNERS da 1.1.x
const EXTRAS = ['settings', 'codeowners', 'apendice', 'iniciativa', 'contenda'];

// ────────────────────────────────────────────────────────────── funções puras

/** Texto da seção `## <titulo>` até o próximo `## ` (fora de bloco cercado). */
function secao(texto, titulo) {
  const linhas = texto.split('\n');
  const out = [];
  let dentro = false;
  let cerca = false;
  for (const l of linhas) {
    if (l.trimStart().startsWith('```')) cerca = !cerca;
    if (!cerca && l.startsWith('## ')) { dentro = l.slice(3).trim().startsWith(titulo); continue; }
    if (dentro) out.push(l);
  }
  return out.join('\n');
}

/** Linhas fora de bloco cercado ```bash, com o número da linha (0-based) e se estão em `## Proibido`. */
function linhasDeProsa(texto) {
  const out = [];
  let cercaBash = false;
  let proibido = false;
  texto.split('\n').forEach((l, i) => {
    if (/^\s*```bash\s*$/.test(l)) { cercaBash = true; return; }
    if (l.trimStart().startsWith('```')) { cercaBash = false; return; }
    if (!cercaBash && l.startsWith('## ')) proibido = l.slice(3).trim().startsWith('Proibido');
    if (!cercaBash) out.push({ l, i, proibido });
  });
  return out;
}

const prefixoDoPlugin = '${CLAUDE_PLUGIN_ROOT}/gates/scripts/';

/** Regras que valem para SKILL.md e trocar.md. */
function violacoesComuns(texto) {
  const v = [];
  const semMarcador = texto.replaceAll(MARCADOR_TIM1, '');
  for (const [i, l] of semMarcador.split('\n').entries()) if (/\bfases?\b/i.test(l)) v.push(`fase: linha ${i + 1}: ${l.trim().slice(0, 60)}`);
  for (const { l, i, proibido } of linhasDeProsa(texto)) {
    if (!proibido && /\b(cole|copie|copiar|colar|digite|digitar)\b/i.test(l)) v.push(`comando-para-colar: linha ${i + 1}: ${l.trim().slice(0, 60)}`);
    if (/--set(?![a-z])/.test(l)) v.push(`--set fora de bloco: linha ${i + 1}`);
  }
  if (/--tudo/.test(texto)) v.push('--tudo');
  if (/--root\s+"?\.(?![\w/])/.test(texto) || /instalar\.sh"?\s+"?\.(?![\w/])/.test(texto)) v.push('raiz-ponto: --root . ou instalar.sh .');
  // todo uso de script do gate: caminho do PLUGIN (nunca `tools/`, nunca nome solto dentro de bloco bash)
  const emBash = new Set(texto.split('\n').map((l, i) => i).filter((i) => !linhasDeProsa(texto).some((x) => x.i === i) && !texto.split('\n')[i].trimStart().startsWith('```')));
  texto.split('\n').forEach((l, i) => {
    for (const arq of ['onboarding.mjs', 'harness-doctor.mjs']) {
      for (const m of l.matchAll(new RegExp(`(\\S*?)${arq.replace('.', '\\.')}`, 'g'))) {
        const solto = m[1] === '' || m[1] === '`';
        if (m[1].includes(prefixoDoPlugin)) continue;
        if (solto && !emBash.has(i)) continue; // nome solto em prosa ("a versão do `onboarding.mjs`") não é comando
        v.push(`${arq}-fora-do-plugin: ${m[0]}`);
      }
    }
  });
  if (/capacidade\.mjs/.test(texto)) v.push('chama-capacidade (a orquestração vem do detectar)');
  // MINOR-5 (r2): comando de terminal para o usuário instalar plugin é comando para colar, mesmo sem o verbo
  if (/claude plugin (install|add)/.test(texto)) v.push('comando-de-instalar-plugin');
  return v;
}

function violacoesSkill(texto) {
  const v = violacoesComuns(texto);
  const fluxo = secao(texto, 'Fluxo');
  const trocar = secao(texto, 'Trocar um item');
  for (const t of ['Fluxo', 'Trocar um item', 'Modo --vincular', 'Proibido']) if (!new RegExp(`^## ${t}`, 'm').test(texto)) v.push(`sem-secao: ${t}`);
  if (/^## Fase /im.test(texto)) v.push('secao-fase');
  if (texto.split('\n').length > 140) v.push(`linhas: ${texto.split('\n').length} > 140`);
  // 3 fixas na ordem, ancoradas em `## Fluxo`
  const [a, b, c] = ['politica', 'autonomia', 'perfil'].map((n) => fluxo.indexOf(`\`${n}\``));
  if (!(a >= 0 && a < b && b < c)) v.push('fixas-fora-de-ordem');
  if (!/só as `perguntas` que o `detectar` devolveu/.test(fluxo)) v.push('condicionais-fora-do-script');
  if (/resolvidoEm/.test(fluxo) || /resolvidoEm/.test(trocar)) v.push('resolvidoEm-no-fluxo');
  // fechamento lista `trocar <item>` com os 5 fatos, as 3 decisões e os 5 de fora das perguntas
  const fecha = fluxo.split('\n').find((l) => /trocar <item>/.test(l) && /tipo_repo/.test(l)) ?? '';
  const todos = [...ORDEM_ITENS, ...IDS_FIXAS, ...EXTRAS];
  const faltam = todos.filter((id) => !fecha.includes(`\`${id}\``));
  if (!/trocar <item>/.test(fluxo) || faltam.length > 0) v.push(`cita-trocar: faltam ${faltam.join(',') || 'trocar <item>'}`);
  if (!/^## Trocar um item/m.test(texto) || !/trocar\.md/.test(trocar)) v.push('trocar-sem-ponteiro-para-trocar.md');
  // 1.1.x presente => --atualizar
  if (!/`tools\/gabarito-gates\/`, `harness\.config\.json` ou `AGENTS\.md`/.test(fluxo) || !/instalar\.sh" "<raiz>" --atualizar/.test(fluxo)) v.push('sem-atualizar-com-110');
  // os 5 itens de fora das perguntas não são procedimento do Fluxo
  if (/--settings|ferramentas-mcp|CODEOWNERS|enabledPlugins/.test(fluxo)) v.push('fora-das-perguntas-no-fluxo');
  if (!/git rev-parse --show-toplevel/.test(fluxo)) v.push('sem-raiz-do-git');
  if (!/headless[^\n]*\n?[^\n]*--dry-run[\s\S]{0,200}não grave/.test(fluxo)) v.push('sem-headless-dry-run');
  if (!/deteccao_mudou[\s\S]{0,400}No máximo 2 voltas/.test(fluxo)) v.push('sem-teto-deteccao-mudou');
  if (!/Mostre a linha `── N criado\(s\)…`, a lista de `\.novo` e cada linha que começa com `AVISO:`/.test(fluxo)) v.push('repassa-saida-do-instalador');
  // MAJOR-2 (r2): o aviso de hooks git (R20) não instalados e a renumeração R19–R21 não podem virar silêncio
  if (!/hooks do git de versionamento não foram instalados[\s\S]{0,200}aplicar o `versionamento-check\.mjs\.novo`/.test(fluxo)) v.push('sem-aviso-hooks-git');
  if (!/passam a R30 em diante/.test(fluxo)) v.push('sem-aviso-renumeracao');
  if (!/sem o comando que ela sugere/.test(fluxo)) v.push('aviso-com-comando');
  // MAJOR-3 (r2): as opções saem na ordem do script, com o default primeiro: Enter o confirma
  if (!/na ordem do script, sem reordenar \(o default vem primeiro, então Enter o confirma\)/.test(fluxo)) v.push('sem-default-primeiro');
  // MINOR-4 (r2): teto por chamada, parar se o Write falha, sufixo (default)
  if (!/com no máximo 4 perguntas por chamada/.test(fluxo)) v.push('sem-teto-4-por-chamada');
  if (!/se o `Write` falhar, pare: nunca rode o passo 6 com o arquivo antigo/.test(fluxo)) v.push('sem-parar-se-write-falha');
  if (!/ao default acrescente ` \(default\)`/.test(fluxo)) v.push('sem-sufixo-default');
  // MINOR-1 (r2): o doctor acha a raiz sozinho (git rev-parse a partir do cwd): sem `cd` nem permissão de `cd`
  if (/(^|[\s`])cd\s+"?<raiz>/m.test(fluxo)) v.push('cd-no-doctor');
  // MINOR-7 (r2): fala para quem adota pela primeira vez; o fechamento não despeja jargão
  if (!/frases curtas, sem siglas internas/.test(texto)) v.push('sem-regra-de-linguagem-simples');
  const fechamento = fluxo.split('\n').find((l) => /^8\. \*\*Fechamento\.\*\*/.test(l)) ?? '';
  if (/\bR\d+\b|esteira|§|docs\/harness|calibrar/.test(fechamento)) v.push(`jargao-no-fechamento: ${(/\bR\d+\b|esteira|§|docs\/harness|calibrar/.exec(fechamento) ?? [''])[0]}`);
  if (/CONDUZ/.test(texto)) v.push('instrucao-ao-modelo-no-texto-do-usuario');
  if (!/copiado sem mudar/.test(fluxo) || !/mesma ordem de chaves/.test(fluxo)) v.push('previa-sem-copia-fiel');
  if (!/`Read` antes do `Write`/.test(fluxo)) v.push('sem-read-antes-do-write');
  if (!/com o tipo JSON/.test(fluxo)) v.push('sem-tipo-json');
  if (!/até 2 chamadas/.test(fluxo)) v.push('sem-limite-de-chamadas');
  if (!/harness-doctor\.mjs" --explain/.test(fluxo)) v.push('sem-doctor');
  if (!/--base origin\/<base>/.test(fluxo)) v.push('sem-base-do-gabarito.yml');
  for (const arq of ['PULL_REQUEST_TEMPLATE.md', 'CHANGELOG.md', 'backlog.md']) if (!fluxo.includes(arq)) v.push(`sem-instalar-${arq}`);
  // allowed-tools
  const at = (texto.match(/^allowed-tools:.*$/m) ?? [''])[0];
  for (const t of ['Write', 'Bash(cp:*)', 'Bash(test:*)', 'Bash(git rev-parse:*)', 'AskUserQuestion', 'Edit']) if (!at.includes(t)) v.push(`allowed-tools sem ${t}`);
  if (at.includes('claude mcp list')) v.push('allowed-tools com claude mcp list');
  if (at.includes('mcp__')) v.push('allowed-tools com mcp__');
  if (/Bash\(cd:/.test(at)) v.push('allowed-tools com cd');
  return v;
}

/** MINOR-2 (r2): comando que toca arquivo do projeto usa `<raiz>/` por extenso; caminho relativo cai na subpasta da sessão. */
function violacoesRaizRelativa(texto) {
  const v = [];
  texto.split('\n').forEach((l, i) => {
    if (!/\b(test -e|mkdir -p|cp -n|grep|writeFileSync|rmSync)\b/.test(l)) return;
    for (const m of l.matchAll(/(^|[\s"'(`])((?:\.github|\.harness|\.claude|docs)(?:\/[\w./<>-]*)?)(?![\w-])/g)) v.push(`raiz-relativa: linha ${i + 1}: ${m[2]}`);
  });
  return v;
}

function violacoesTrocar(texto) {
  const v = violacoesComuns(texto);
  for (const id of EXTRAS) if (!new RegExp(`^## ${id}\\b`, 'm').test(texto)) v.push(`sem-secao: ${id}`);
  const s = secao(texto, 'settings');
  if (!/dois oks separados/.test(s) || !/sem default `sim`/.test(s)) v.push('settings-sem-dois-consentimentos');
  const i = secao(texto, 'iniciativa');
  if (!/Antes de qualquer chamada `mcp__\*`/.test(i)) v.push('iniciativa-sem-ok-antes-do-mcp');
  if (!/ADR-FLX-2/.test(i) || !/default \*\*não\*\*/.test(i)) v.push('iniciativa-escrita-sem-default-nao');
  if (!texto.includes(MARCADOR_TIM1)) v.push('codeowners-sem-marcador-tim1');
  v.push(...violacoesRaizRelativa(texto));
  return v;
}

const planta = (real, de, para) => {
  assert.ok(real.includes(de), `âncora ausente no texto real: ${de}`);
  return real.replaceAll(de, para);
};

// ────────────────────────────────────────────────────────────── textos reais

test('skill-real-sem-violacoes', () => {
  assert.deepEqual(violacoesSkill(SKILL), []);
  assert.deepEqual(violacoesTrocar(TROCAR), []);
});

test('skill-3-fixas-na-ordem', () => {
  assert.deepEqual(violacoesSkill(planta(SKILL, '`politica`, `autonomia` e `perfil`', '`perfil`, `autonomia` e `politica`')), ['fixas-fora-de-ordem']);
  // âncora na seção: as 3 palavras fora do `## Fluxo` (aqui, no `## Trocar um item`) não bastam
  const [antes, depois] = SKILL.split('## Trocar um item');
  const semNoFluxo = antes.replaceAll('`politica`', 'x').replaceAll('`autonomia`', 'y').replaceAll('`perfil`', 'z');
  assert.ok(violacoesSkill(`${semNoFluxo}## Trocar um item${depois}\n`).includes('fixas-fora-de-ordem'), 'sem as 3 no Fluxo falha');
});

test('skill-condicionais-so-do-script', () => {
  assert.ok(violacoesSkill(planta(SKILL, 'só as `perguntas` que o `detectar` devolveu', 'as perguntas que achar úteis')).includes('condicionais-fora-do-script'));
});

test('skill-sem-resolvidoEm', () => {
  assert.ok(violacoesSkill(planta(SKILL, '## Trocar um item\n', '## Trocar um item\nSe falta `fluxo.resolvidoEm`, rode tudo.\n')).includes('resolvidoEm-no-fluxo'));
  assert.ok(violacoesSkill(planta(SKILL, '## Fluxo\n', '## Fluxo\nRode o que falta em `onboarding.resolvidoEm`.\n')).includes('resolvidoEm-no-fluxo'));
});

test('skill-sem-fase', () => {
  const casos = ['Fases 2–4 rodam depois.', 'Faça a fase 2.', 'o onboarding tem quatro fases', '(fase 4)'];
  for (const c of casos) {
    const r = violacoesSkill(planta(SKILL, '## Fluxo\n', `## Fluxo\n${c}\n`));
    assert.ok(r.some((x) => x.startsWith('fase:')), `${c} => ${JSON.stringify(r)}`);
  }
  assert.ok(violacoesSkill(`${SKILL}\n## Fase 1\n`).includes('secao-fase'));
  // o marcador do CODEOWNERS da 1.1.x é a única exceção, por texto exato
  assert.deepEqual(violacoesComuns(`x ${MARCADOR_TIM1}`), []);
  assert.ok(violacoesComuns(`x ${MARCADOR_TIM1} e a fase 3`).some((x) => x.startsWith('fase:')));
  assert.ok(violacoesTrocar(TROCAR.replace(MARCADOR_TIM1, '(gabarito-instalar, fase 3). Outro')).some((x) => x.startsWith('fase:')));
});

test('skill-sem-comando-para-colar', () => {
  for (const [nome, texto, planta1] of [['SKILL', SKILL, violacoesSkill], ['TROCAR', TROCAR, violacoesTrocar]]) {
    for (const palavra of ['Cole', 'copie', 'Copiar', 'colar', 'Digite', 'digitar']) {
      const r = planta1(`${palavra} este comando no terminal.\n${texto}`);
      assert.ok(r.some((x) => x.startsWith('comando-para-colar')), `${nome} ${palavra}: ${JSON.stringify(r)}`);
    }
    assert.ok(planta1(`Use --tudo para refazer.\n${texto}`).includes('--tudo'), `${nome} --tudo`);
    // `--set` só dentro de bloco bash: em prosa é violação nomeada; dentro do bloco, passa
    const prosa = planta1(`Rode o script com --set fluxo para gravar.\n${texto}`);
    assert.ok(prosa.some((x) => x.startsWith('--set fora de bloco')), `${nome}: ${JSON.stringify(prosa)}`);
    assert.equal(planta1(`\`\`\`bash\nnode x.mjs --set fluxo '{}'\n\`\`\`\n${texto}`).some((x) => x.startsWith('--set fora de bloco')), false, 'dentro de bloco passa');
    // `--settings` não é `--set`
    assert.equal(planta1(`Use --settings no script.\n${texto}`).some((x) => x.startsWith('--set fora')), false);
  }
  // as palavras dentro de `## Proibido` são permitidas (a seção as proíbe)
  assert.ok(/## Proibido[\s\S]*\b(colar|digitar)\b/i.test(SKILL), '## Proibido nomeia o que é proibido');
  assert.deepEqual(violacoesSkill(SKILL), []);
});

test('skill-cita-trocar', () => {
  const FECHA = SKILL.split('\n').find((l) => /trocar <item>/.test(l) && /tipo_repo/.test(l));
  assert.ok(FECHA, 'o fechamento tem a linha `trocar <item>`');
  const semNaLinha = (x) => planta(SKILL, FECHA, FECHA.replace(`\`${x}\``, x));
  for (const id of [...ORDEM_ITENS, ...IDS_FIXAS, ...EXTRAS]) assert.ok(violacoesSkill(semNaLinha(id)).includes(`cita-trocar: faltam ${id}`), id);
  assert.ok(violacoesSkill(planta(SKILL, FECHA, FECHA.replaceAll('trocar <item>', 'troca'))).some((x) => x.startsWith('cita-trocar')));
  // os ids de ORDEM_ITENS são os que o doctor usa; skill, trocar.md e doctor têm de casar
  const doctor = readFileSync(join(PLUGIN, 'gates', 'scripts', 'harness-doctor.mjs'), 'utf8');
  const cmd = readFileSync(join(PLUGIN, 'commands', 'gabarito-doctor.md'), 'utf8');
  const validos = new Set([...ORDEM_ITENS, ...IDS_FIXAS, ...EXTRAS]);
  const citados = [...doctor.matchAll(/trocar (\w+)\)/g), ...doctor.matchAll(/trocar \$\{(item)\}/g), ...cmd.matchAll(/trocar (\w+)\)/g)].map((m) => m[1]).filter((x) => x !== 'item');
  assert.ok(citados.length >= 3, `o doctor cita ids de trocar (${citados})`);
  for (const id of citados) assert.ok(validos.has(id), `doctor/comando cita "trocar ${id}", que a skill não conhece`);
  for (const id of citados) assert.ok(SKILL.includes(`\`${id}\``), `skill não menciona ${id}`);
  // MINOR-3 (r2): o doctor e o comando mandam o MESMO `trocar <item>` para o aviso `modelo-resolvido`
  const doctorId = /modelo-resolvido[\s\S]{0,400}?gabarito-instalar \(trocar (\w+)\)/.exec(doctor)?.[1];
  const cmdId = /modelo-resolvido[^\n]*gabarito-instalar \(trocar (\w+)\)/.exec(cmd)?.[1];
  assert.ok(doctorId && cmdId, `doctor=${doctorId} comando=${cmdId}`);
  assert.equal(cmdId, doctorId, 'doctor e comando dão o mesmo nome para a mesma ação');
  // FX3 r2: `orquestracao` deixou de ser "trocar perfil" (regra mudou): recalibra o paralelismo, com prévia e ok, na seção `orquestracao` do trocar.md
  assert.ok(SKILL.includes(`\`${doctorId}\`: recalibra o paralelismo desta máquina`), 'a skill descreve o que o doctor manda fazer');
  assert.match(TROCAR, /^## orquestracao\b/m);
  assert.match(TROCAR, /"_recalibrar": true/);
  assert.match(TROCAR, /sem default `sim`/);
  assert.doesNotMatch(cmd, /\(fase \d/);
});

test('skill-atualizar-com-110', () => {
  assert.ok(violacoesSkill(planta(SKILL, 'instalar.sh" "<raiz>" --atualizar', 'instalar.sh" "<raiz>"')).includes('sem-atualizar-com-110'));
  assert.ok(violacoesSkill(planta(SKILL, '`tools/gabarito-gates/`, `harness.config.json` ou `AGENTS.md`', '`tools/gabarito-gates/`')).includes('sem-atualizar-com-110'));
});

test('skill-fora-das-perguntas-so-no-trocar', () => {
  for (const intruso of ['Grave `.claude/settings.json` com --settings.', 'Crie o CODEOWNERS.', 'Leia ferramentas-mcp.json.', 'Ligue enabledPlugins.']) {
    assert.ok(violacoesSkill(planta(SKILL, '## Fluxo\n', `## Fluxo\n${intruso}\n`)).includes('fora-das-perguntas-no-fluxo'), intruso);
  }
  // trocar.md carrega os 5 procedimentos
  for (const id of EXTRAS) assert.ok(violacoesTrocar(TROCAR.replace(new RegExp(`^## ${id}\\b`, 'm'), `## x${id}`)).includes(`sem-secao: ${id}`), id);
  assert.ok(violacoesTrocar(planta(TROCAR, 'dois oks separados', 'um ok')).includes('settings-sem-dois-consentimentos'));
  assert.ok(violacoesTrocar(planta(TROCAR, 'sem default `sim`', 'com default `sim`')).includes('settings-sem-dois-consentimentos'));
  assert.ok(violacoesTrocar(planta(TROCAR, 'Antes de qualquer chamada `mcp__*`', 'Depois de ler')).includes('iniciativa-sem-ok-antes-do-mcp'));
  assert.ok(violacoesTrocar(planta(TROCAR, 'default **não**', 'default **sim**')).includes('iniciativa-escrita-sem-default-nao'));
  assert.ok(violacoesTrocar(TROCAR.replace(MARCADOR_TIM1, '(gabarito-instalar). Uma linha por área:')).includes('codeowners-sem-marcador-tim1'));
});

test('skill-raiz-do-git', () => {
  assert.ok(violacoesSkill(planta(SKILL, 'detectar --root "<raiz>"', 'detectar --root .')).includes('raiz-ponto: --root . ou instalar.sh .'));
  assert.ok(violacoesSkill(planta(SKILL, 'instalar.sh" "<raiz>" --atualizar', 'instalar.sh" . --atualizar')).includes('raiz-ponto: --root . ou instalar.sh .'));
  assert.ok(violacoesSkill(planta(SKILL, 'git rev-parse --show-toplevel', 'git rev-parse HEAD')).includes('sem-raiz-do-git'));
  // a raiz literal passa (sem falso positivo em `--root "<raiz>"` nem em `.claude-tmp`)
  assert.deepEqual(violacoesComuns('node x --root "<raiz>" .claude-tmp/a.json ./x'), []);
});

test('skill-onboarding-do-plugin', () => {
  const r = violacoesSkill(planta(SKILL, '"${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding.mjs" detectar', '"tools/gabarito-gates/scripts/onboarding.mjs" detectar'));
  assert.ok(r.some((x) => x.startsWith('onboarding.mjs-fora-do-plugin')), JSON.stringify(r));
  const d = violacoesSkill(planta(SKILL, '"${CLAUDE_PLUGIN_ROOT}/gates/scripts/harness-doctor.mjs" --explain', '"tools/gabarito-gates/scripts/harness-doctor.mjs" --explain'));
  assert.ok(d.some((x) => x.startsWith('harness-doctor.mjs-fora-do-plugin')), JSON.stringify(d));
  assert.ok(violacoesSkill(`${SKILL}\nnode "\${CLAUDE_PLUGIN_ROOT}/gates/scripts/capacidade.mjs" --sugerir\n`).some((x) => x.startsWith('chama-capacidade')));
});

test('skill-headless-dry-run', () => {
  assert.ok(violacoesSkill(planta(SKILL, '--dry-run', '--sem-gravar')).includes('sem-headless-dry-run'));
  assert.ok(violacoesSkill(planta(SKILL, 'não grave', 'grave')).includes('sem-headless-dry-run'));
});

test('skill-deteccao-mudou-teto', () => {
  assert.ok(violacoesSkill(planta(SKILL, 'No máximo 2 voltas', 'Quantas voltas precisar')).includes('sem-teto-deteccao-mudou'));
});

test('skill-contrato-do-fluxo', () => {
  // cada cláusula do contrato tem caso plantado
  assert.ok(violacoesSkill(planta(SKILL, 'Mostre a linha `── N criado(s)…`', 'Mostre a saída')).includes('repassa-saida-do-instalador'));
  assert.ok(violacoesSkill(planta(SKILL, 'copiado sem mudar', 'resumido')).includes('previa-sem-copia-fiel'));
  assert.ok(violacoesSkill(planta(SKILL, 'mesma ordem de chaves', 'qualquer ordem')).includes('previa-sem-copia-fiel'));
  assert.ok(violacoesSkill(planta(SKILL, '`Read` antes do `Write`', '`Write`')).includes('sem-read-antes-do-write'));
  assert.ok(violacoesSkill(planta(SKILL, 'com o tipo JSON', 'como texto')).includes('sem-tipo-json'));
  assert.ok(violacoesSkill(planta(SKILL, 'até 2 chamadas', 'quantas quiser')).includes('sem-limite-de-chamadas'));
  assert.ok(violacoesSkill(planta(SKILL, '--base origin/<base>', '--base origin/main')).includes('sem-base-do-gabarito.yml'));
  assert.ok(violacoesSkill(planta(SKILL, 'CHANGELOG.md', 'X.md')).includes('sem-instalar-CHANGELOG.md'));
  assert.ok(violacoesSkill(planta(SKILL, 'Write, ', '')).includes('allowed-tools sem Write'));
  assert.ok(violacoesSkill(planta(SKILL, 'Bash(cp:*)', 'Bash(claude mcp list:*), Bash(cp:*)')).includes('allowed-tools com claude mcp list'));
  assert.ok(violacoesSkill(planta(SKILL, 'AskUserQuestion', 'AskUserQuestion, mcp__x__y')).includes('allowed-tools com mcp__'));
  assert.ok(violacoesSkill(`${SKILL}${'x\n'.repeat(60)}`).some((x) => x.startsWith('linhas:')));
  assert.ok(SKILL.split('\n').length <= 140, `SKILL.md tem ${SKILL.split('\n').length} linhas`);
  assert.ok(violacoesSkill(SKILL.replace('## Proibido', '## Outra')).includes('sem-secao: Proibido'));
});

test('skill-enter-confirma-o-default', () => {
  // MAJOR-3 (r2): MR1 trocava "na ordem do script" por "ordem alfabética" e nada caía; em ordem alfabética o Enter grava `continua`/`economia`
  const base = 'na ordem do script, sem reordenar (o default vem primeiro, então Enter o confirma)';
  assert.ok(SKILL.includes(base));
  for (const para of ['em ordem alfabética', 'na ordem do script, sem reordenar', 'ordenadas como achar melhor (o default vem primeiro, então Enter o confirma)', 'na ordem do script, sem reordenar (o default fica por último)']) {
    assert.ok(violacoesSkill(planta(SKILL, base, para)).includes('sem-default-primeiro'), para);
  }
  // o script cumpre a metade dele: o default é a 1ª opção em TODAS as perguntas (o fato `onboarding.test.mjs` prende o resto)
  const raiz = repoVersionamentoAmbiguo();
  const ps = perguntas(detectar(coletarFatos(raiz, { rodar: rodarCom(CLICKUP), hoje: HOJE })), null);
  for (const p of ps) assert.equal(p.opcoes[0].valor, p.default, `${p.id}: Enter confirma o default`);
});

test('skill-clausulas-de-contrato-plantadas', () => {
  // MINOR-4 (r2): MR2, MR3, MR5 do revisor, e o resto do contrato novo, cada uma com o seu caso
  assert.ok(violacoesSkill(planta(SKILL, ', com no máximo 4 perguntas por chamada', '')).includes('sem-teto-4-por-chamada'));
  assert.ok(violacoesSkill(planta(SKILL, 'com no máximo 4 perguntas por chamada', 'com quantas perguntas quiser por chamada')).includes('sem-teto-4-por-chamada'));
  assert.ok(violacoesSkill(planta(SKILL, '; se o `Write` falhar, pare: nunca rode o passo 6 com o arquivo antigo', '')).includes('sem-parar-se-write-falha'));
  assert.ok(violacoesSkill(planta(SKILL, 'pare: nunca rode o passo 6 com o arquivo antigo', 'siga com o passo 6')).includes('sem-parar-se-write-falha'));
  assert.ok(violacoesSkill(planta(SKILL, '; ao default acrescente ` (default)`', '')).includes('sem-sufixo-default'));
  assert.ok(violacoesSkill(planta(SKILL, 'acrescente ` (default)`', 'acrescente ` (padrão)`')).includes('sem-sufixo-default'));
  // linguagem de quem adota pela primeira vez
  assert.ok(violacoesSkill(planta(SKILL, 'frases curtas, sem siglas internas', 'frases técnicas')).includes('sem-regra-de-linguagem-simples'));
  const fecha = SKILL.split('\n').find((l) => /^8\. \*\*Fechamento\.\*\*/.test(l));
  assert.ok(fecha, 'o passo 8 existe');
  for (const jargao of ['R1', 'esteira padrão', 'docs/harness/adocao.md §3', 'calibrar antes de ligar']) {
    assert.ok(violacoesSkill(planta(SKILL, fecha, `${fecha} ${jargao}`)).some((x) => x.startsWith('jargao-no-fechamento')), jargao);
  }
  assert.ok(violacoesSkill(planta(SKILL, 'Para subir de nível, o planejamento', 'superpowers CONDUZ o planejamento')).includes('instrucao-ao-modelo-no-texto-do-usuario'));
  // o fechamento não despeja os 13 ids: só a linha opcional "se o usuário pedir a lista" os traz
  assert.match(fecha, /Só se o usuário pedir a lista: `trocar <item>`/);
  // MINOR-1: o doctor não precisa de `cd`
  assert.ok(violacoesSkill(planta(SKILL, 'Bash(cp:*), ', 'Bash(cp:*), Bash(cd:*), ')).includes('allowed-tools com cd'));
  assert.ok(violacoesSkill(planta(SKILL, 'então não precisa de `cd`:', 'então `cd "<raiz>"` antes:')).includes('cd-no-doctor'));
  // MINOR-5: comando para o usuário instalar plugin
  assert.ok(violacoesTrocar(`${TROCAR}\nRode claude plugin install gabarito-mestre@gabarito-mestre.\n`).includes('comando-de-instalar-plugin'));
  assert.ok(violacoesSkill(`${SKILL}\nclaude plugin add x\n`).includes('comando-de-instalar-plugin'));
});

test('trocar-raiz-literal', () => {
  // MINOR-2 (r2): trocar.md usa `<raiz>/` por extenso em todo comando que toca arquivo do projeto
  assert.deepEqual(violacoesRaizRelativa(TROCAR), []);
  for (const ruim of ['test -e .github/CODEOWNERS', "grep -c x .github/CODEOWNERS", 'mkdir -p .github', 'mkdir -p docs/fluxo/epics', 'cp -n a docs/fluxo/iniciativa.md', "node -e 'fs.writeFileSync(\".github/CODEOWNERS\", 1)'", 'test -e .harness/x.json']) {
    assert.ok(violacoesRaizRelativa(ruim).length > 0, ruim);
    assert.ok(violacoesTrocar(`${TROCAR}\n${ruim}\n`).some((x) => x.startsWith('raiz-relativa')), `trocar: ${ruim}`);
  }
  for (const bom of ['test -e "<raiz>/.github/CODEOWNERS"', 'mkdir -p "<raiz>/docs/fluxo/epics"', 'cp -n "${CLAUDE_PLUGIN_ROOT}/templates/fluxo/epic.md" "<raiz>/docs/fluxo/epics/EPIC-EXEMPLO.md"']) {
    assert.deepEqual(violacoesRaizRelativa(bom), [], bom);
  }
  // o procedimento de CODEOWNERS e o de `arquivos` citam a raiz
  assert.match(secao(TROCAR, 'codeowners'), /test -e "<raiz>\/\.github\/CODEOWNERS"/);
  assert.match(secao(TROCAR, 'iniciativa'), /mkdir -p "<raiz>\/docs\/fluxo\/epics"/);
});

// ────────────────────────────────────────────────────────────── MAJOR-2 (r2): o aviso de hooks git chega ao usuário

const INSTALAR = join(PLUGIN, 'scripts', 'instalar.sh');
/** O que a skill manda mostrar do stdout do instalador (SKILL.md, passo 1): a linha `── N criado(s)…`, a lista de `.novo` e as linhas `AVISO:`. */
function linhasQueASkillMostra(saida) {
  return saida.split('\n').filter((l) => /^── \d+ criado\(s\)/.test(l) || /^\s+novo\s+\S+\.novo\b/.test(l) || /^\s*AVISO:/.test(l));
}

test('skill-repassa-aviso-de-hooks-git-da-110', () => {
  // repo já instalado com o gate de versionamento da 1.1.x (sem --msg/--pre-push): `--atualizar` não instala os hooks e AVISA
  const raiz = novoDir('gm-skill-110-');
  G(raiz, ['init', '-q', '-b', 'main']);
  mkdirSync(join(raiz, 'tools', 'gabarito-gates', 'scripts'), { recursive: true });
  writeFileSync(join(raiz, 'tools', 'gabarito-gates', 'scripts', 'versionamento-check.mjs'), 'export const x = 1; // versionamento-check 1.1.x, sem o modo de hook\n');
  writeFileSync(join(raiz, 'AGENTS.md'), '# AGENTS antigo da 1.1.x\n');
  const r = spawnSync('bash', [INSTALAR, raiz, '--atualizar'], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const saida = r.stdout + r.stderr;
  const mostradas = linhasQueASkillMostra(saida);
  const aviso = mostradas.find((l) => /AVISO:/.test(l));
  assert.ok(aviso, `o AVISO está na saída que a skill manda mostrar:\n${mostradas.join('\n')}`);
  assert.match(aviso, /hooks git \(R20\) NÃO instalados/);
  assert.match(aviso, /versionamento-check\.mjs instalado é anterior/);
  assert.ok(mostradas.some((l) => /^── \d+ criado\(s\)/.test(l)), 'a linha-resumo aparece');
  assert.ok(mostradas.some((l) => /AGENTS\.md\.novo/.test(l)), 'a lista de .novo aparece');
  // a linha `Rode: …` que acompanha o aviso é comando para o usuário: a skill NÃO a repassa (e o filtro também não)
  assert.ok(/^\s+Rode: instalar\.sh/m.test(saida), 'premissa: o instalador imprime a linha "Rode:"');
  assert.equal(mostradas.some((l) => /Rode:/.test(l)), false);
  // o hook não foi gravado (o aviso é verdadeiro)
  assert.equal(existsSync(join(raiz, '.git', 'hooks', 'commit-msg')), false);
  // a renumeração R19–R21 → R30+ existe na saída e a skill manda dizê-la, em palavras (a linha `──` não é repassada)
  assert.match(saida, /R19–R21 agora são do harness[^\n]*R30\+/);
  assert.match(secao(SKILL, 'Fluxo'), /Com `--atualizar`, diga também que as regras R19 a R21/);
  // sem a cláusula na skill, o aviso se perde: caso plantado
  assert.ok(violacoesSkill(planta(SKILL, 'e cada linha que começa com `AVISO:`', '')).includes('repassa-saida-do-instalador'));
  assert.ok(violacoesSkill(planta(SKILL, 'não foram instalados', 'foram instalados')).includes('sem-aviso-hooks-git'));
  assert.ok(violacoesSkill(planta(SKILL, 'passam a R30 em diante', 'continuam')).includes('sem-aviso-renumeracao'));
  assert.ok(violacoesSkill(planta(SKILL, 'sem o comando que ela sugere', 'com o comando que ela sugere')).includes('aviso-com-comando'));
});

// ────────────────────────────────────────────────────────────── P9: o exemplo da skill passa pelo `gravar` real

const limpar = [];
const novoDir = (p = 'gm-skill-') => { const d = realpathSync(mkdtempSync(join(tmpdir(), p))); limpar.push(d); return d; };
process.on('exit', () => { for (const d of limpar) rmSync(d, { recursive: true, force: true }); });
const quando = (dia) => ({ GIT_AUTHOR_DATE: `${dia}T12:00:00Z`, GIT_COMMITTER_DATE: `${dia}T12:00:00Z` });
const G = (dir, args, env = {}) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
  cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
});
function montarRepo(dir) {
  G(dir, ['init', '-q', '-b', 'main']);
  G(dir, ['add', '-A']);
  G(dir, ['commit', '-q', '--allow-empty', '-m', 'init'], quando('2025-01-01'));
  const bare = novoDir('gm-skill-bare-');
  G(bare, ['init', '-q', '--bare', '-b', 'main']);
  G(dir, ['remote', 'add', 'origin', bare]);
  G(dir, ['push', '-q', 'origin', 'main']);
  G(dir, ['remote', 'set-head', 'origin', 'main']);
  return dir;
}
let n = 0;
function mergear(dir, base, data) {
  n += 1;
  G(dir, ['checkout', '-q', '-b', `f${n}`, base]);
  writeFileSync(join(dir, `f${n}.txt`), 'x');
  G(dir, ['add', '-A']);
  G(dir, ['commit', '-q', '-m', `feat: f${n}`], quando(data));
  G(dir, ['checkout', '-q', base]);
  G(dir, ['merge', '-q', '--no-ff', '-m', `Merge f${n}`, `f${n}`], quando(data));
  G(dir, ['push', '-q', 'origin', base]);
}
const HOJE = '2025-06-30';
const CLICKUP = 'claude.ai ClickUp: https://mcp.clickup.com/mcp - ✔ Connected\n';
const SEM_MCP = 'No MCP servers configured.\n';
const rodarCom = (claude) => (cmd, args, opts) => (cmd === 'claude' ? { rc: 0, stdout: claude, stderr: '', motivo: null } : rodarReal(cmd, args, opts));

/** O bloco ```json do `## Fluxo`, como objeto. */
function exemploDaSkill(texto = SKILL) {
  const m = /```json\n([\s\S]*?)\n\s*```/.exec(secao(texto, 'Fluxo'));
  assert.ok(m, 'a skill traz um exemplo ```json de respostas no ## Fluxo');
  return JSON.parse(m[1]);
}

/** Passa o exemplo (com `_previa` trocada pelos `itens` reais) pelo `gravar` real, em dry-run. Condicionais que o exemplo não traz usam o default. */
function gravarExemplo(raiz, exemplo, claude) {
  const rodar = rodarCom(claude);
  const fatos = coletarFatos(raiz, { rodar, hoje: HOJE });
  const itens = detectar(fatos);
  const resp = { ...exemplo };
  if ('_previa' in resp) resp._previa = JSON.parse(JSON.stringify(itens));
  const ids = perguntas(itens, fatos.configExistente).map((p) => p.id);
  for (const k of Object.keys(resp)) if (k !== '_previa' && !ids.includes(k)) delete resp[k]; // o exemplo ilustra 1 condicional; outro repo tem outras
  for (const id of ids) if (!(id in resp)) resp[id] = perguntas(itens, fatos.configExistente).find((p) => p.id === id).default;
  const arq = join(novoDir('gm-skill-resp-'), 'respostas.json');
  writeFileSync(arq, JSON.stringify(resp));
  return gravar(raiz, arq, { rodar, hoje: HOJE, fuso: 'UTC', dryRun: true });
}

function repoVersionamentoAmbiguo() {
  const raiz = novoDir();
  writeFileSync(join(raiz, 'package.json'), '{"name":"x"}');
  mkdirSync(join(raiz, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(raiz, '.github', 'workflows', 'd.yml'), 'name: deploy-producao\non:\n  push:\n    branches: [main]\njobs:\n  d:\n    environment: producao\n');
  montarRepo(raiz);
  G(raiz, ['checkout', '-q', '-b', 'staging', 'main']);
  G(raiz, ['push', '-q', 'origin', 'staging']);
  mergear(raiz, 'main', '2025-06-10');
  for (const d of ['2025-06-05', '2025-06-12', '2025-06-20']) mergear(raiz, 'staging', d);
  return raiz;
}

test('skill-exemplo-respostas-aceito-pelo-gravar', () => {
  // (1) 1 pergunta condicional (versionamento ambíguo): o exemplo, como está, é aceito pelo gravar real
  const raiz = repoVersionamentoAmbiguo();
  const ex = exemploDaSkill();
  assert.ok('_previa' in ex, 'o exemplo traz `_previa`');
  const r = gravarExemplo(raiz, ex, CLICKUP);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.dryRun, true, 'dry-run: nada gravado');
  // no repo do exemplo, as chaves do exemplo são exatamente as perguntas (sem chave a mais nem a menos)
  const ps = perguntas(detectar(coletarFatos(raiz, { rodar: rodarCom(CLICKUP), hoje: HOJE })), null);
  assert.deepEqual(Object.keys(ex).filter((k) => k !== '_previa').sort(), ps.map((p) => p.id).sort());
  // (2) fixture de 5 perguntas (monorepo sem MCP): as 3 fixas do exemplo + defaults das 2 condicionais
  const mono = novoDir();
  cpSync(join(AQUI, 'fixtures', 'onboarding', 'monorepo'), mono, { recursive: true });
  montarRepo(mono);
  const r5 = gravarExemplo(mono, ex, SEM_MCP);
  assert.equal(r5.ok, true, JSON.stringify(r5));
  const n5 = perguntas(detectar(coletarFatos(mono, { rodar: rodarCom(SEM_MCP), hoje: HOJE })), null).length;
  assert.equal(n5, 5, 'fixture de 5 perguntas');
  // (3) o exemplo é o do contrato: tipos JSON (booleano, não "não")
  assert.equal(typeof ex.autonomia, 'boolean');
  assert.equal(typeof ex.politica, 'string');
});

test('skill-exemplo-recusado-quando-quebrado', () => {
  // o teste acima falharia sem estas garantias: exemplo com texto no lugar de booleano, ou sem `_previa`, é recusado pelo gravar real
  const raiz = repoVersionamentoAmbiguo();
  const ex = exemploDaSkill();
  const ruim = gravarExemplo(raiz, { ...ex, autonomia: 'não' }, CLICKUP);
  assert.deepEqual([ruim.ok, ruim.erro], [false, 'resposta_fora_das_opcoes']);
  const { _previa, ...semPrevia } = ex;
  const sem = gravarExemplo(raiz, semPrevia, CLICKUP);
  assert.deepEqual([sem.ok, sem.erro], [false, 'previa_ausente']);
});
