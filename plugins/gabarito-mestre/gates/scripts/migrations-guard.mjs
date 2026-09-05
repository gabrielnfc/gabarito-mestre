#!/usr/bin/env node
/**
 * GATE G8 — guarda de migrations.
 *
 * Duas funções, nesta ordem de importância:
 *   G8a  REPROVA migration destrutiva ou de dado que não traga plano de volta.
 *   G8b  IMPRIME o SQL das migrations novas (e o plano de volta) para o comentário da PR.
 *
 * DECISÕES DE DESENHO, TODAS DELIBERADAS
 *
 * 1. Grep, não parser (I9). O objetivo não é entender SQL — é obrigar um humano a
 *    olhar. Falso positivo custa uma linha de justificativa no plano de volta;
 *    falso negativo custa uma tabela.
 *
 * 2. Isenção de ação referencial de FK. `ON DELETE CASCADE` / `ON UPDATE CASCADE`
 *    aparecem em toda FK que o ORM gera e não destroem dado. Sem a isenção, a
 *    medição no repositório de origem deu 11 falsos positivos em 36 migrations —
 *    e guarda que grita sempre é guarda desligada.
 *
 * 3. CORTE TEMPORAL pinado por teste. Sem ele, a primeira PR que integra o
 *    histórico trava para sempre nas migrations antigas. Mudar a constante tem que
 *    ser decisão visível, não efeito colateral — por isso o teste a fixa.
 *
 * 4. Migration que SOME reprova. Migration já aplicada não pode sair do repo: o
 *    histórico do banco continua a listá-la e a esteira nunca mais fecha "up to date".
 *
 * 5. Detecção do que é ADITIVO NA FORMA e DESTRUTIVO NO EFEITO: flip de ação
 *    referencial `RESTRICT`/`NO ACTION` → `CASCADE` não casa nenhum padrão de DROP
 *    e apaga linhas em cascata. É o furo clássico de guardas ingênuas.
 *
 * USO
 *   node migrations-guard.mjs --base origin/main --dir prisma/migrations
 *   node migrations-guard.mjs --base origin/main --dir prisma/migrations --comment > body.md
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Só diretórios com carimbo >= isto precisam de plano de volta. PINADO POR TESTE. */
export const MIGRATION_GUARD_CUTOFF = '00000000000000';

/** Nome do arquivo que serve de ack humano. Pode conter SQL de volta OU a justificativa da irreversibilidade. */
export const ROLLBACK_FILE = 'rollback.sql';

export const COMMENT_MARKER = '<!-- harness-migrations-guard -->';
export const COMMENT_MAX_CHARS = 60_000;

/**
 * `(?<!\bON\s+)` isenta a ação referencial de FK. `DROP CONSTRAINT|INDEX|DEFAULT`
 * ficam DE FORA de propósito: não destroem dado e o ORM os gera de rotina.
 */
export const DESTRUCTIVE_PATTERN =
  /\b(DROP\s+(TABLE|COLUMN|TYPE|SCHEMA|SEQUENCE|DATABASE)|TRUNCATE|(?<!\bON\s+)UPDATE|(?<!\bON\s+)DELETE)\b/i;

/** Aditivo na forma, destrutivo no efeito. */
export const REFERENTIAL_FLIP_PATTERN = /\bON\s+DELETE\s+CASCADE\b/i;

/** Remove comentários de linha antes de casar — `-- TRUNCATE ...` não é TRUNCATE. */
export function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

export function isDestructive(sql) {
  const limpo = stripSqlComments(sql);
  if (DESTRUCTIVE_PATTERN.test(limpo)) return { destructive: true, reason: 'padrão destrutivo' };
  if (REFERENTIAL_FLIP_PATTERN.test(limpo)) {
    return { destructive: true, reason: 'ON DELETE CASCADE — aditivo na forma, destrutivo no efeito' };
  }
  return { destructive: false, reason: null };
}

/** Extrai o carimbo do diretório: `20260817195715_nome` → `20260817195715`. */
export function timestampOf(dir) {
  const base = dir.split('/').filter(Boolean).pop() ?? '';
  const m = /^(\d{14})_/.exec(base);
  return m ? m[1] : null;
}

/**
 * Um diretório está DENTRO do corte quando tem carimbo VÁLIDO e >= cutoff.
 * Carimbo malformado conta como dentro do corte (fail-closed): diretório criado à
 * mão não pode escapar da guarda por não parecer uma migration.
 */
export function withinCutoff(dir, cutoff = MIGRATION_GUARD_CUTOFF) {
  const ts = timestampOf(dir);
  if (ts === null) return true;
  return ts >= cutoff;
}

export class GitRefIndisponivel extends Error {}

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // Gate que roda no CI nunca despeja stack trace: quem lê o log precisa da CAUSA
    // e do conserto, não do frame interno do Node.
    const detalhe = String(e?.stderr ?? e?.message ?? '').trim().split('\n')[0];
    throw new GitRefIndisponivel(
      `não consegui ler o histórico (${detalhe}). ` +
        `A guarda compara o diff contra uma ref base — confira o --base e garanta ` +
        `histórico completo no checkout (\`fetch-depth: 0\`).`,
    );
  }
}

/** Arquivos de migration adicionados, modificados ou renomeados. */
export function changedMigrations(base, dir, cwd = process.cwd()) {
  const out = git(['diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`, '--', dir], cwd);
  return out
    .split('\n')
    .filter((f) => f.trim().endsWith('/migration.sql'))
    .map((f) => f.trim());
}

/** Arquivos de migration REMOVIDOS (`--no-renames` pega também o nome antigo de um rename). */
export function removedMigrations(base, dir, cwd = process.cwd()) {
  const out = git(
    ['diff', '--name-only', '--diff-filter=D', '--no-renames', `${base}...HEAD`, '--', dir],
    cwd,
  );
  return out
    .split('\n')
    .filter((f) => f.trim().endsWith('/migration.sql'))
    .map((f) => f.trim());
}

export function evaluate({ base, dir, cwd = process.cwd(), cutoff = MIGRATION_GUARD_CUTOFF }) {
  const alteradas = changedMigrations(base, dir, cwd);
  const removidas = removedMigrations(base, dir, cwd);

  const itens = alteradas.map((file) => {
    const migrationDir = dirname(file);
    const sql = existsSync(join(cwd, file)) ? readFileSync(join(cwd, file), 'utf8') : '';
    const { destructive, reason } = isDestructive(sql);
    const dentroDoCorte = withinCutoff(migrationDir, cutoff);
    const rollbackPath = join(migrationDir, ROLLBACK_FILE);
    const temRollback = existsSync(join(cwd, rollbackPath));
    const rollback = temRollback ? readFileSync(join(cwd, rollbackPath), 'utf8') : null;

    // Arquivo vazio não é plano: exige conteúdo (SQL de volta OU justificativa escrita).
    const rollbackVazio = temRollback && rollback.trim().length === 0;

    return {
      file,
      dir: migrationDir,
      sql,
      destructive,
      reason,
      dentroDoCorte,
      temRollback,
      rollbackVazio,
      rollback,
      reprovado: destructive && dentroDoCorte && (!temRollback || rollbackVazio),
    };
  });

  const falhas = [
    ...itens.filter((i) => i.reprovado).map((i) => ({ tipo: 'sem-plano-de-volta', item: i })),
    ...removidas.map((file) => ({ tipo: 'migration-removida', file })),
  ];

  return { itens, removidas, falhas, ok: falhas.length === 0 };
}

export function renderComment(resultado) {
  const linhas = [COMMENT_MARKER, ''];
  if (resultado.itens.length === 0 && resultado.removidas.length === 0) {
    linhas.push('_Nenhuma migration nesta PR. (Comentário anterior, se houver, está **superado**.)_');
    return linhas.join('\n');
  }

  linhas.push('## Migrations desta PR', '');
  for (const i of resultado.itens) {
    const marca = i.destructive ? `⚠️ **destrutiva** (${i.reason})` : '✅ aditiva';
    const plano = i.temRollback
      ? i.rollbackVazio
        ? '❌ plano de volta VAZIO'
        : '✅ plano de volta presente'
      : i.destructive && i.dentroDoCorte
        ? '❌ plano de volta AUSENTE'
        : '—';
    linhas.push(`### \`${i.dir}\``, `${marca} · ${plano}`, '', '````sql', i.sql.trimEnd(), '````', '');
    if (i.rollback && !i.rollbackVazio) {
      linhas.push(
        '<details><summary>plano de volta — leia a afirmação de reversibilidade</summary>',
        '',
        '````sql',
        i.rollback.trimEnd(),
        '````',
        '</details>',
        '',
      );
    }
  }
  for (const f of resultado.removidas) {
    linhas.push(`### ❌ removida: \`${f}\``, 'Migration já aplicada não pode sair do repo.', '');
  }

  const corpo = linhas.join('\n');
  return corpo.length > COMMENT_MAX_CHARS
    ? `${corpo.slice(0, COMMENT_MAX_CHARS)}\n\n_…truncado._`
    : corpo;
}

function main(argv) {
  const arg = (nome, fallback) => {
    const i = argv.indexOf(`--${nome}`);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const base = arg('base', 'origin/main');
  const dir = arg('dir', 'prisma/migrations');
  const comentar = argv.includes('--comment');

  let resultado;
  try {
    resultado = evaluate({ base, dir });
  } catch (e) {
    if (e instanceof GitRefIndisponivel) {
      console.error(`::error::[G8] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  if (comentar) {
    process.stdout.write(renderComment(resultado));
    process.exit(0);
  }

  for (const f of resultado.falhas) {
    if (f.tipo === 'sem-plano-de-volta') {
      console.error(
        `::error::[G8] ${f.item.dir} é destrutiva (${f.item.reason}) e ` +
          `${f.item.rollbackVazio ? `o ${ROLLBACK_FILE} está vazio` : `não tem ${ROLLBACK_FILE}`}. ` +
          `Escreva o SQL de volta OU a justificativa da irreversibilidade e o procedimento manual. ` +
          `O plano precisa dizer COMO reidentifica as linhas: um UPDATE de volta "por estado" ` +
          `só vale se nenhum outro caminho do app produz aquele estado.`,
      );
    } else {
      console.error(
        `::error::[G8] ${f.file} foi REMOVIDA. Migration já aplicada não pode sair do repo — ` +
          `o histórico do banco continua a exigi-la. A correção é uma migration NOVA.`,
      );
    }
  }

  if (resultado.ok) {
    console.log(
      `[G8] ok — ${resultado.itens.length} migration(s) avaliada(s), ` +
        `${resultado.itens.filter((i) => i.destructive).length} destrutiva(s) com plano de volta.`,
    );
  }
  process.exit(resultado.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
