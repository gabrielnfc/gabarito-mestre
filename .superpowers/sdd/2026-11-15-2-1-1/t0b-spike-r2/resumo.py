import json,glob,sys,os
base='/Users/gabs-dev/projetos_pessoais/gabarito-mestre/.harness/worktrees/T0b/.claude-tmp/gm15-t0b/r2'
for n in sys.argv[1:]:
    print('==',n)
    for f in sorted(glob.glob(f'{base}/{n}/out/mod/*.json')):
        d=json.load(open(f)); print(' ',d['ev'],d['carga'],'loaded=',d['loaded'],'disco=',d['disco'],json.dumps(d['dado'])[:int(os.environ.get('W','0'))])
