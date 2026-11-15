#!/usr/bin/env python3
"""Sessao interativa real via pty. uso: rodar-pty.py <nome> <roteiro.json>
roteiro: lista de passos [["send", "texto"], ["wait", seg], ["disco", "0.2.9"], ["key", "enter"]]
Salva a tela bruta em out/tela.raw. Config da conta, haiku, cwd isolado dentro da worktree."""
import os, pty, sys, time, json, select, shutil, subprocess
WT = '/Users/gabs-dev/projetos_pessoais/gabarito-mestre/.harness/worktrees/T0b'
nome, roteiro = sys.argv[1], json.load(open(sys.argv[2]))
R = f'{WT}/.claude-tmp/gm15-t0b/r2/{nome}'
shutil.rmtree(R, ignore_errors=True)
os.makedirs(f'{R}/out/mod'); os.makedirs(f'{R}/cwd')
shutil.copytree(f'{WT}/.superpowers/sdd/2026-11-15-2-1-1/t0b-spike-r2/plug', f'{R}/plug')
env = dict(os.environ, TMPDIR='/private/var/folders/6d/fxf284xn73q8c8hk32n_0_lh0000gp/T/gabarito-76a6d5f31db07928', TERM='xterm-256color', COLUMNS='120', LINES='40')
args = ['claude', '--model', 'claude-haiku-5-5', '--setting-sources', 'project', '--strict-mcp-config', '--plugin-dir', f'{R}/plug']
log = open(f'{R}/out/driver.log', 'w'); log.write('cmd: ' + ' '.join(args) + '\n')
pid, fd = pty.fork()
if pid == 0:
    os.chdir(f'{R}/cwd'); os.execvpe('claude', args, env)
raw = open(f'{R}/out/tela.raw', 'wb')
def drena(seg):
    fim = time.time() + seg
    while time.time() < fim:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try: d = os.read(fd, 65536)
            except OSError: return False
            if not d: return False
            raw.write(d); raw.flush()
    return True
KEYS = {'enter': b'\r', 'esc': b'\x1b', 'ctrlc': b'\x03'}
for p in roteiro:
    log.write(f'{time.time():.0f} {p}\n'); log.flush()
    if p[0] == 'wait':
        if not drena(p[1]): break
    elif p[0] == 'send':
        os.write(fd, p[1].encode()); drena(1); os.write(fd, b'\r')
    elif p[0] == 'key':
        os.write(fd, KEYS[p[1]])
    elif p[0] == 'disco':
        open(f'{R}/plug/.claude-plugin/plugin.json', 'w').write('{ "name": "gm15t0b", "version": "%s", "description": "Sonda r2" }' % p[1])
try: os.kill(pid, 15)
except Exception: pass
log.write('fim\n')
