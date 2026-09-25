/**
 * Testes do GUARDA de entrypoint ESM dos 8 scripts de gates.
 *
 * O bug (achado pelo revisor da T9): todos os scripts terminam com
 *   if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(...);
 * `import.meta.url` do módulo principal é resolvido pelo Node com o caminho REAL
 * (symlinks seguidos), mas `path.resolve(process.argv[1])` é só textual. Quando o
 * script é chamado através de QUALQUER symlink (macOS `/var` → `/private/var`, um
 * link "current" de cache de plugin, um bin do npm/homebrew, `tools/gabarito-gates`
 * num repo symlinkado), a comparação falha e `main()` nunca roda — em silêncio,
 * saindo com 0, como se tudo estivesse ok.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  guarda compara `resolve(argv[1])` sem realpath (o bug original) — falha (a)
 *      para os 8 scripts hoje, porque o symlink explícito criado no teste já é a
 *      indireção, em qualquer SO (não depende do tmpdir estar sob /var).
 *  M2  guarda sempre roda main() mesmo quando o módulo é importado (sem CLI) —
 *      falha (b): main() rodaria e escreveria saída/exit mesmo em import().
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(AQUI, '..', 'scripts');

// Um por script: os args mais baratos que fazem main() produzir uma saída
// reconhecível e determinística, sem efeito colateral, rodando numa tmpdir vazia.
//   deploy-order-check : sem harness.config.json → cfg={} → main() sem args já
//                         escreve o erro "harness.config.json não declara deployOrder".
//   harness-doctor      : --json → JSON com a chave "resultados" (sempre presente).
//   capacidade          : --json → JSON com a chave "slots" (sempre presente, mesmo
//                         no ramo de fail-open).
//   cartao-sessao       : sem harness.config.json → semOnboarding=true → linha fixa
//                         "GABARITO: harness sem onboarding".
//   quality-ratchet     : sem .quality/baseline.json → mensagem fixa "FALTA [baseline]".
//   migrations-guard    : tmpdir não é git repo → mensagem fixa "não consegui ler o
//                         histórico" (não escreve nada, só falha ao rodar git diff).
//   onboarding-config   : sem --set/--settings → imprime a linha de uso ("uso:
//                         onboarding-config.mjs") e sai, sem tocar disco.
//   versionamento-check : --root . (evita raizDoRepo() escalar) --json → JSON com a
//                         chave "achados" (sempre presente).
const SCRIPTS = [
  {
    arquivo: 'deploy-order-check.mjs',
    args: [],
    assinatura: '[ordem de subida]',
  },
  {
    arquivo: 'harness-doctor.mjs',
    args: ['--json'],
    assinatura: '"resultados"',
  },
  {
    arquivo: 'capacidade.mjs',
    args: ['--json'],
    assinatura: '"slots"',
  },
  {
    arquivo: 'cartao-sessao.mjs',
    args: [],
    assinatura: 'GABARITO: harness sem onboarding',
  },
  {
    arquivo: 'quality-ratchet.mjs',
    args: [],
    assinatura: 'FALTA [baseline]',
  },
  {
    arquivo: 'migrations-guard.mjs',
    args: [],
    assinatura: 'não consegui ler o histórico',
  },
  {
    arquivo: 'onboarding-config.mjs',
    args: ['--dry-run'],
    assinatura: 'uso: onboarding-config.mjs',
  },
  {
    arquivo: 'versionamento-check.mjs',
    args: ['--root', '.', '--json'],
    assinatura: '"achados"',
  },
];

for (const { arquivo, args, assinatura } of SCRIPTS) {
  const caminhoReal = join(SCRIPTS_DIR, arquivo);

  describe(`guarda de entrypoint — ${arquivo}`, () => {
    test('(a) main() roda quando invocado por um symlink', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'gm-entrypoint-'));
      const link = join(tmp, 'link.mjs');
      symlinkSync(caminhoReal, link);

      const r = spawnSync(process.execPath, [link, ...args], {
        cwd: tmp,
        encoding: 'utf8',
        timeout: 15_000,
      });

      const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      assert.ok(
        saida.includes(assinatura),
        `esperava a assinatura de main() (${JSON.stringify(assinatura)}) na saída de ` +
          `${arquivo} rodado via symlink, mas veio: ${JSON.stringify(saida)} (exit=${r.status})`,
      );
    });

    test('(b) main() NÃO roda quando o módulo é importado', () => {
      const url = pathToFileURL(caminhoReal).href;
      // `node -e`/`--input-type=module` deixa process.argv[1] undefined — igual a
      // um `await import(...)` de dentro de outro módulo (nunca é o CLI). Se main()
      // rodasse aqui, imprimiria a assinatura e/ou chamaria process.exit() antes do
      // sentinela IMPORT_OK.
      const codigo =
        `import(${JSON.stringify(url)}).then(() => { process.stdout.write('IMPORT_OK\\n'); })` +
        `.catch((e) => { process.stderr.write('IMPORT_ERR:' + String(e && e.message) + '\\n'); process.exitCode = 2; });`;

      const r = spawnSync(process.execPath, ['--input-type=module', '-e', codigo], {
        encoding: 'utf8',
        timeout: 15_000,
      });

      const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      assert.ok(
        saida.includes('IMPORT_OK'),
        `esperava o sentinela IMPORT_OK (import concluiu sem main() travar o processo) ` +
          `para ${arquivo}, mas veio: ${JSON.stringify(saida)} (exit=${r.status})`,
      );
      assert.ok(
        !saida.includes(assinatura),
        `importar ${arquivo} não deveria rodar main() (achei a assinatura ${JSON.stringify(assinatura)} na saída: ${JSON.stringify(saida)})`,
      );
    });
  });
}
