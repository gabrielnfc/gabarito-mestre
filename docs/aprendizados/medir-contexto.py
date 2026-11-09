#!/usr/bin/env python3
# Contexto da sessão principal: uso do último turno do orquestrador, janela de 1M (F11, Opus e Fable).
# Uso: medir-contexto.py <prefixo do id da sessão>. Só imprime números.
import glob, json, os, sys

pasta = os.path.join(os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude'), 'projects', '' + os.getcwd().replace('/', '-').replace('_', '-'))
arquivos = glob.glob(f'{pasta}/{sys.argv[1]}*.jsonl')
if len(arquivos) != 1:
    sys.exit(f'transcript: {len(arquivos)} encontrados')
uso = None
for linha in open(arquivos[0], errors='ignore'):
    try:
        o = json.loads(linha)
    except ValueError:
        continue
    if o.get('type') == 'assistant' and not o.get('isSidechain'):
        uso = o.get('message', {}).get('usage') or uso
if uso is None:
    sys.exit('sem usage')
total = sum(uso.get(k, 0) for k in ('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'))
print(total, f'{total / 10000:.1f}%')
