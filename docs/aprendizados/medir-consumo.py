import json,glob,os,collections
base=os.path.expanduser('~/.claude/projects/-Users-gabs-dev-projetos-pessoais-gabarito-mestre')
t=collections.defaultdict(lambda:[0,0,0,0]);vistos=set();ag=0
for f in glob.glob(base+'/*/subagents/*.jsonl'):
    hoje=False
    with open(f,errors='ignore') as h:
        for l in h:
            try:o=json.loads(l)
            except:continue
            if not str(o.get('timestamp','')).startswith('2026-11-03'):continue
            hoje=True
            m=o.get('message') or {}
            u=m.get('usage');i=m.get('id')
            if not u or not i or i in vistos:continue
            vistos.add(i);a=t[m.get('model','?')]
            a[0]+=u.get('input_tokens',0);a[1]+=u.get('cache_creation_input_tokens',0);a[2]+=u.get('cache_read_input_tokens',0);a[3]+=u.get('output_tokens',0)
    ag+=hoje
print('agentes',ag)
for k,v in sorted(t.items()):print(k,'entrada',v[0],'escrita',v[1],'leitura',v[2],'saida',v[3])
