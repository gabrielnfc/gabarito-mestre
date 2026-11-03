import json,glob,os,datetime as d,collections
base=os.path.expanduser('~/.claude/projects/-Users-gabs-dev-projetos-pessoais-gabarito-mestre')
hoje='2026-11-03'
g=collections.defaultdict(list)
for f in glob.glob(base+'/*/subagents/*.jsonl'):
    ts=[];model=None;prompt=None
    with open(f,errors='ignore') as h:
        for l in h:
            try:o=json.loads(l)
            except:continue
            t=o.get('timestamp')
            if t:ts.append(t)
            m=o.get('message') or {}
            if not model and m.get('model'):model=m['model']
            if prompt is None and o.get('type')=='user':
                c=m.get('content')
                prompt=c if isinstance(c,str) else (c[0].get('text','') if c and isinstance(c,list) and isinstance(c[0],dict) else '')
    if not ts or not ts[0].startswith(hoje):continue
    a=d.datetime.fromisoformat(ts[0].replace('Z','+00:00'));b=d.datetime.fromisoformat(ts[-1].replace('Z','+00:00'))
    p=(prompt or '').lower()
    k='sombra' if 'sombra' in p else 'review' if 'review' in p else 'spike' if 'spike' in p else 'impl' if 'task-' in p or 'brief' in p else 'outro'
    g[k].append((b-a).total_seconds())
tot=0
for k,v in sorted(g.items()):
    v.sort();tot+=sum(v);print(k,'n',len(v),'soma_min',round(sum(v)/60),'mediana_s',round(v[len(v)//2]))
print('soma_min',round(tot/60))
