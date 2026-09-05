#!/usr/bin/env node
/**
 * GATE — ordem de subida travada por teste.
 *
 * A ordem correta é **consumidor → produtor**: quem LÊ o dado novo sobe antes de quem
 * o ESCREVE. Invertida, a versão velha ignora o campo novo e produz resultado errado
 * **sem erro em lugar nenhum** — a pior classe de falha que existe, porque nada
 * apita e a descoberta vem por auditoria, semanas depois.
 *
 * POR QUE ISTO É UM TESTE E NÃO UM COMENTÁRIO
 * Ordem escrita em comentário não é gate. E um teste que confere se o COMENTÁRIO
 * existe é teatro documentado: passa verde enquanto o laço abaixo dele está invertido.
 * Este script lê a ordem REAL das ocorrências no arquivo do pipeline.
 *
 * LIMITE DECLARADO
 * É grep sobre texto (I9), não análise do grafo do pipeline. Ele prova a ordem em que
 * os comandos aparecem no arquivo — o que é exatamente onde o erro acontece — e não
 * prova a ordem em que a plataforma os executa se houver paralelismo declarado.
 * Se o seu pipeline paralelizar deploys, este gate precisa de outra forma.
 *
 * CONFIGURAÇÃO — `harness.config.json`:
 *   {
 *     "deployOrder": [
 *       { "label": "staging",
 *         "file": ".github/workflows/deploy-staging.yml",
 *         "deploy":   ["SVC_WORKER", "SVC_API"],
 *         "rollback": ["SVC_API", "SVC_WORKER"],
 *         "rollbackSection": "rollback" }
 *     ]
 *   }
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Recorta o arquivo a partir da primeira linha que casa `sectionPattern`. */
export function scopeFrom(content, sectionPattern) {
  if (!sectionPattern) return content;
  const re = new RegExp(sectionPattern, 'i');
  const linhas = content.split('\n');
  const i = linhas.findIndex((l) => re.test(l));
  return i === -1 ? '' : linhas.slice(i).join('\n');
}

/** Verifica que os tokens aparecem NESTA ordem, pela primeira ocorrência de cada um. */
export function checkSequence(content, tokens) {
  const posicoes = tokens.map((t) => ({ token: t, at: content.indexOf(t) }));
  const ausentes = posicoes.filter((p) => p.at === -1);
  if (ausentes.length) {
    return { ok: false, reason: `token(s) não encontrado(s): ${ausentes.map((a) => a.token).join(', ')}` };
  }
  for (let i = 1; i < posicoes.length; i += 1) {
    if (posicoes[i].at < posicoes[i - 1].at) {
      return {
        ok: false,
        reason: `"${posicoes[i].token}" aparece ANTES de "${posicoes[i - 1].token}" — ordem invertida`,
      };
    }
  }
  return { ok: true };
}

export function evaluate(cfg, root = process.cwd()) {
  const regras = cfg.deployOrder ?? [];
  if (!regras.length) {
    return { ok: false, falhas: [{ label: '(config)', reason: 'harness.config.json não declara "deployOrder"' }] };
  }

  const falhas = [];
  for (const r of regras) {
    const caminho = join(root, r.file);
    if (!existsSync(caminho)) {
      falhas.push({ label: r.label ?? r.file, reason: `arquivo não encontrado: ${r.file}` });
      continue;
    }
    const conteudo = readFileSync(caminho, 'utf8');

    if (r.deploy) {
      const escopo = scopeFrom(conteudo, r.deploySection);
      const res = checkSequence(escopo, r.deploy);
      if (!res.ok) falhas.push({ label: `${r.label ?? r.file} · deploy`, reason: res.reason });
    }

    if (r.rollback) {
      const escopo = scopeFrom(conteudo, r.rollbackSection ?? 'rollback');
      if (!escopo) {
        falhas.push({ label: `${r.label ?? r.file} · rollback`, reason: 'seção de rollback não encontrada' });
      } else {
        const res = checkSequence(escopo, r.rollback);
        if (!res.ok) falhas.push({ label: `${r.label ?? r.file} · rollback`, reason: res.reason });
      }
    }
  }

  return { ok: falhas.length === 0, falhas };
}

function main() {
  const cfgPath = join(process.cwd(), 'harness.config.json');
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const out = evaluate(cfg);

  for (const f of out.falhas) {
    console.error(
      `::error::[ordem de subida] ${f.label}: ${f.reason}. ` +
        `Consumidor sobe ANTES do produtor; o rollback é a ordem inversa. ` +
        `Inverter isto produz resultado errado sem erro em lugar nenhum.`,
    );
  }
  if (out.ok) console.log('[ordem de subida] ok');
  process.exit(out.ok ? 0 : 1);
}

// Entrypoint robusto a espaço/acento no caminho: `file://` cru falha com %20 e o script sairia 0 em silêncio.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
