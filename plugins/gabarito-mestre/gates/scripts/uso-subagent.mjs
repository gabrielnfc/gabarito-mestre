#!/usr/bin/env node
/** Stub (E2 Task 1): consome o stdin e sai 0 sem imprimir nada. A lógica chega nas Tasks 8 e 10. */
import { readFileSync } from 'node:fs';

try {
  readFileSync(0);
} catch {
  /* stdin ausente: nada a fazer */
}
process.exitCode = 0;
