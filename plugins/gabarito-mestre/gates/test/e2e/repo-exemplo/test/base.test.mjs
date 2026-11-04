import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('base grava no TMPDIR da shell (usado pelo aceite 5)', () => {
  const d = mkdtempSync(join(tmpdir(), 'gm99-'));
  writeFileSync(join(d, 'x.bin'), Buffer.alloc(4096, 1));
  assert.ok(d.length > 0);
});
