#!/usr/bin/env node
// Lista por task. Não agrega por fluxo: tasks têm tamanho e risco diferentes, e comparar grupos sugeriria efeito que os dados não sustentam.
import { readFileSync } from 'node:fs';
const linhas = readFileSync(new URL('./metricas-e1.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
for (const l of linhas) console.log(`${l.task}: ${((l.impl_s + l.review_s + l.correcao_s) / 60).toFixed(1)} min, ${l.rodadas} rodada(s), ${l.estado}, causa ${l.causa}`);
