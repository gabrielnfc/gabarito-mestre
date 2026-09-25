#!/usr/bin/env node
/**
 * GATE — ratchet de qualidade.
 *
 * Três portões sequenciais sobre um baseline COMMITADO. O ratchet nunca melhora
 * sozinho: subir o baseline é ato deliberado, visível no diff da PR (regra R4).
 *
 * ┌ cobertura   ratchet por pacote, com tolerância
 * ├ duplicação  teto FIXO — sem aceite, teto é teto
 * └ violações   `errors` reprova SEMPRE; `warnings` é ratchet
 *
 * A GENERALIZAÇÃO QUE IMPORTA — o denominador
 *
 * A forma clássica de um ratchet de cobertura mentir é o DENOMINADOR encolher: um
 * arquivo sai do universo coberto (config mudou, glob quebrou, pasta renomeada) e a
 * porcentagem SOBE sem ninguém ter escrito um teste. O gate passa, verde, mentindo.
 *
 * A defesa original era exigir que cada runner declarasse seu universo explicitamente.
 * Isso é específico de cada ferramenta. A defesa equivalente e portátil: **guardar a
 * CONTAGEM DE ARQUIVOS no baseline e reprovar quando ela cai.** Menos arquivos medidos
 * do que ontem é suspeito por construção, seja qual for o runner.
 *
 * ENTRADAS (todas opcionais — o que não existe é reportado como ausente, nunca como ok)
 *   coverage    `coverage-summary.json` de Jest/Vitest (`--coverageReporters=json-summary`)
 *   duplicação  relatório JSON do jscpd (ou compatível: `{ statistics.total.percentage }`)
 *   violações   `eslint -f json`
 *
 * USO
 *   node quality-ratchet.mjs                 # avalia
 *   node quality-ratchet.mjs --accept        # sobe o baseline (deliberado, commitado)
 *   node quality-ratchet.mjs --bootstrap     # cria o baseline pela primeira vez
 *
 * SEMPRE rode DEPOIS dos testes, na mesma cadeia: `npm test && npm run quality`.
 * Run vermelho nunca deve gravar baseline — e o `--accept` recusa quando há `errors`.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOLERANCE = 0.5; // pontos percentuais — ruído natural entre runs
export const METRICAS = ['lines', 'statements', 'functions', 'branches'];

const DEFAULTS = {
  baselineFile: '.quality/baseline.json',
  /** { nome: 'caminho/para/coverage-summary.json' } */
  coverage: {},
  duplication: { report: null, ceiling: 2 },
  violations: { report: null },
};

function lerJson(caminho) {
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
}

/** Extrai percentuais + CONTAGEM DE ARQUIVOS de um `coverage-summary.json`. */
export function lerCobertura(resumo) {
  if (!resumo || !resumo.total) return null;
  const out = { files: Object.keys(resumo).filter((k) => k !== 'total').length };
  for (const m of METRICAS) {
    const v = resumo.total[m];
    out[m] = typeof v?.pct === 'number' ? v.pct : null;
  }
  return out;
}

export function lerDuplicacao(relatorio) {
  const pct = relatorio?.statistics?.total?.percentage;
  return typeof pct === 'number' ? pct : null;
}

/** `eslint -f json` devolve um array de arquivos com contagens. */
export function lerViolacoes(relatorio) {
  if (!Array.isArray(relatorio)) return null;
  return relatorio.reduce(
    (acc, f) => ({
      errors: acc.errors + (f.errorCount ?? 0),
      warnings: acc.warnings + (f.warningCount ?? 0),
    }),
    { errors: 0, warnings: 0 },
  );
}

/** Coleta o estado ATUAL a partir dos relatórios configurados. */
export function coletar(cfg, root = process.cwd()) {
  const coverage = {};
  const ausentes = [];

  for (const [nome, caminho] of Object.entries(cfg.coverage ?? {})) {
    const resumo = lerJson(join(root, caminho));
    const lido = lerCobertura(resumo);
    if (!lido) ausentes.push(`cobertura de "${nome}" (${caminho})`);
    else coverage[nome] = lido;
  }

  const dupPath = cfg.duplication?.report;
  const duplication = dupPath ? lerDuplicacao(lerJson(join(root, dupPath))) : null;
  if (dupPath && duplication === null) ausentes.push(`duplicação (${dupPath})`);

  const vioPath = cfg.violations?.report;
  const violations = vioPath ? lerViolacoes(lerJson(join(root, vioPath))) : null;
  if (vioPath && violations === null) ausentes.push(`violações (${vioPath})`);

  return { coverage, duplication, violations, ausentes };
}

/**
 * Compara atual × baseline. Devolve falhas com a razão — nunca só "falhou".
 */
export function avaliar(atual, baseline, cfg) {
  const falhas = [];

  // ── relatório ausente é FALHA, nunca "ok por omissão"
  for (const a of atual.ausentes) {
    falhas.push({
      portao: 'entrada',
      razao: `relatório ausente: ${a}. Ausência de medição não é aprovação — rode os testes antes.`,
    });
  }

  // ── cobertura
  for (const [nome, base] of Object.entries(baseline.coverage ?? {})) {
    const cur = atual.coverage[nome];
    if (!cur) {
      falhas.push({
        portao: 'cobertura',
        razao: `o pacote "${nome}" está no baseline mas não foi medido agora — pacote sem lane fura a rede em silêncio`,
      });
      continue;
    }

    // O DENOMINADOR. Vem antes das porcentagens de propósito: uma queda aqui
    // explica (e invalida) qualquer "melhora" percentual medida junto.
    if (typeof base.files === 'number' && cur.files < base.files) {
      falhas.push({
        portao: 'cobertura',
        razao:
          `"${nome}": o universo medido ENCOLHEU (${base.files} → ${cur.files} arquivos). ` +
          `Porcentagem sobe sozinha quando arquivo sai da conta — isto é verde mentindo, não melhora. ` +
          `Confira o glob de cobertura antes de aceitar.`,
      });
    }

    for (const m of METRICAS) {
      if (typeof base[m] !== 'number' || typeof cur[m] !== 'number') continue;
      if (cur[m] < base[m] - TOLERANCE) {
        falhas.push({
          portao: 'cobertura',
          razao: `"${nome}" ${m}: ${cur[m].toFixed(2)}% < ${base[m].toFixed(2)}% − ${TOLERANCE}`,
        });
      }
    }
  }

  // ── duplicação: teto fixo, sem aceite
  const teto = cfg.duplication?.ceiling ?? DEFAULTS.duplication.ceiling;
  if (typeof atual.duplication === 'number' && atual.duplication > teto) {
    falhas.push({
      portao: 'duplicação',
      razao: `${atual.duplication.toFixed(2)}% acima do teto de ${teto}%. Teto é teto — não há aceite aqui.`,
    });
  }

  // ── violações
  if (atual.violations) {
    if (atual.violations.errors > 0) {
      falhas.push({
        portao: 'violações',
        razao: `${atual.violations.errors} erro(s) de lint. Erro reprova SEMPRE, inclusive com --accept.`,
      });
    }
    const baseW = baseline.violations?.warnings;
    if (typeof baseW === 'number' && atual.violations.warnings > baseW) {
      falhas.push({
        portao: 'violações',
        razao: `avisos subiram: ${baseW} → ${atual.violations.warnings}`,
      });
    }
  }

  return { ok: falhas.length === 0, falhas };
}

/** Monta o baseline novo a partir do atual. */
export function novoBaseline(atual) {
  return {
    coverage: atual.coverage,
    violations: atual.violations ? { errors: 0, warnings: atual.violations.warnings } : undefined,
    _nota: 'Gerado por quality-ratchet --accept. Subir o baseline é ato deliberado (R4).',
  };
}

export function run(root = process.cwd(), { accept = false, bootstrap = false } = {}) {
  const cfgPath = join(root, 'harness.config.json');
  const fileCfg = existsSync(cfgPath) ? lerJson(cfgPath) ?? {} : {};
  const cfg = { ...DEFAULTS, ...(fileCfg.quality ?? {}) };

  const baselinePath = join(root, cfg.baselineFile);
  const baselineExiste = existsSync(baselinePath);
  const baseline = baselineExiste ? lerJson(baselinePath) ?? {} : {};

  const atual = coletar(cfg, root);

  if (bootstrap) {
    if (baselineExiste) {
      return { modo: 'bootstrap', ok: false, falhas: [{ portao: 'baseline', razao: `${cfg.baselineFile} já existe — use --accept` }] };
    }
    if (atual.ausentes.length) {
      return { modo: 'bootstrap', ok: false, falhas: atual.ausentes.map((a) => ({ portao: 'entrada', razao: `relatório ausente: ${a}` })) };
    }
    return { modo: 'bootstrap', ok: true, atual, escrever: { path: baselinePath, conteudo: novoBaseline(atual) } };
  }

  if (!baselineExiste) {
    return {
      modo: 'avaliar',
      ok: false,
      atual,
      falhas: [{ portao: 'baseline', razao: `${cfg.baselineFile} não existe. Rode --bootstrap e COMMITE o arquivo.` }],
    };
  }

  const veredito = avaliar(atual, baseline, cfg);

  if (accept) {
    // Run vermelho nunca grava baseline. `errors` de lint é a evidência barata
    // de que o run não está saudável; aceitar aqui congelaria a regressão.
    const erros = atual.violations?.errors ?? 0;
    if (erros > 0) {
      return {
        modo: 'accept',
        ok: false,
        atual,
        falhas: [{ portao: 'violações', razao: `${erros} erro(s) de lint — --accept RECUSADO. Run vermelho nunca grava baseline.` }],
      };
    }
    if (atual.ausentes.length) {
      return {
        modo: 'accept',
        ok: false,
        atual,
        falhas: atual.ausentes.map((a) => ({ portao: 'entrada', razao: `relatório ausente: ${a} — --accept RECUSADO` })),
      };
    }
    return { modo: 'accept', ok: true, atual, veredito, escrever: { path: baselinePath, conteudo: novoBaseline(atual) } };
  }

  return { modo: 'avaliar', ...veredito, atual };
}

function render(out) {
  const l = [];
  if (out.atual) {
    for (const [nome, c] of Object.entries(out.atual.coverage)) {
      l.push(`  ${nome.padEnd(16)} ${METRICAS.map((m) => `${m[0]}:${(c[m] ?? 0).toFixed(1)}%`).join('  ')}  (${c.files} arquivos)`);
    }
    if (typeof out.atual.duplication === 'number') l.push(`  duplicação       ${out.atual.duplication.toFixed(2)}%`);
    if (out.atual.violations) l.push(`  violações        ${out.atual.violations.errors} erro(s), ${out.atual.violations.warnings} aviso(s)`);
  }
  for (const f of out.falhas ?? []) l.push(`  FALTA [${f.portao}] ${f.razao}`);
  return l.join('\n');
}

function main(argv) {
  const accept = argv.includes('--accept');
  const bootstrap = argv.includes('--bootstrap');
  const out = run(process.cwd(), { accept, bootstrap });

  console.log('quality-ratchet');
  console.log(render(out));

  if (out.escrever) {
    // O diretório do baseline pode não existir no primeiro bootstrap.
    mkdirSync(dirname(out.escrever.path), { recursive: true });
    writeFileSync(out.escrever.path, `${JSON.stringify(out.escrever.conteudo, null, 2)}\n`);
    console.log(`\nbaseline gravado em ${out.escrever.path} — COMMITE o arquivo e explique a mudança no corpo da PR (R4).`);
  }

  process.exit(out.ok ? 0 : 1);
}

// Entrypoint robusto a espaço/acento e a symlink: `file://` cru falha com %20, e comparar
// contra `resolve(argv[1])` sem realpath falha atrás de qualquer symlink (macOS /var,
// cache de plugin, bin do npm/homebrew) — o script sairia 0 em silêncio nos dois casos.
function ehEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}
if (ehEntrypoint()) main(process.argv.slice(2));
