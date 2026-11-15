# Relatório T0b (GM-15), 2026-11-15: spikes S4, S5, S8. PARCIAL: sessão real bloqueada por credencial

Método: claude 2.1.325. (1) Tentativa de sessão real com config e HOME isolados em `.claude-tmp/gm15-t0b/{cfg,home}` (A6): `claude -p "responda ok"` => "Not logged in · Please run /login" (1/1). Sem `ANTHROPIC_API_KEY` nem `CLAUDE_CODE_OAUTH_TOKEN` no ambiente (checado só por nome). Copiar credencial da conta seria ler segredo (regra 1), então não fiz. Usar a config da conta (como a T0b da GM-14, efeito colateral E21: sessões gravadas em `~/.claude-conta2/projects`) não está autorizado neste brief: PAREI aí. (2) `gh secret list` (leitura, só nomes): 0 segredos de Actions. (3) Leitura dos tipos da plataforma (`claude-code.d.ts` desta build) e do relatório T0b da GM-14.

| Spike | Número | Veredito | Consequência |
|---|---|---|---|
| S4 (i) mod lê a versão carregada e compara com o disco | N = 0 sessões (bloqueio). Tipos: `$.plugin` só tem `name` e `root` (sem `version`); `plugin.register` traz `version` do manifesto (é a versão em memória); disco por `$.fs` em `$.plugin.root`/.claude-plugin/plugin.json. Só presença no tipo (I2) | NÃO MEDIDA | T17/T20: seguir o plano B declarado ("não conferível") até medir; se medir, hook `plugin.register` guarda `version` no store e compara com o disco |
| S4 (ii) mod liga `/loop` ou detecta wakeup | N = 0. Tipos: `Stop`/`SubagentStop` trazem `session_crons[]` ({id, schedule, recurring, prompt}) "CronCreate, ScheduleWakeup, /loop"; `prompt.submit.source = 'loop_wakeup'`. Não há API do mod para ligar `/loop`. Presença no tipo, não observada | NÃO MEDIDA | Sinal candidato: `session_crons` não vazio no `classic.Stop` do mod (a confirmar com ScheduleWakeup real, N = 3) |
| S5 forma de `background_tasks` de shell com `integrar` na `description` | N = 0 com `integrar`. Medida anterior (GM-14 S14, 3 sessões): shell de orquestrador em `Stop.background_tasks` com `type: 'shell'`, `description`, `command`, 3/3, some do Stop seguinte 3/3. Tipo: `description` e `command` até 1000 caracteres | PARCIAL (forma CONFIRMADA por medição anterior; caso `integrar` não medido) | T16 pode ler `type==='shell'` e `description`/`command`; a `description` é a do modelo, então o caso real com `integrar` fica a medir (N >= 3) |
| S8 `/clear` real no CI | Credencial: 0 segredos de Actions no repo (`gh secret list` vazio) e `ci.yml` sem `ANTHROPIC`/`secrets.`. Pousos reais N = 0 | REFUTADA para o CI (sem credencial); retomadas/contexto não medidos | Plano B do POU-3 (T20): par simulado `sessao.pouso` => `sessao.inicio {origem:'clear'}`; `/clear` real 1 vez por release em sessão local |

## Não mede
- Qualquer comportamento de sessão real (S4 i/ii, S5 `integrar`, retomadas e contexto do S8). Tipos provam presença, nunca ausência nem comportamento.
- Se há como fornecer credencial ao CI sem segredo de Actions (fora do repo).

## O que fica pendente (decisão do orquestrador/dono)
Autorizar sessão real com a config da conta em cwd isolado (precedente GM-14 T0b, E21) ou fornecer credencial isolada (`ANTHROPIC_API_KEY` só para o spike); então rodar 3 sessões com mod de sonda (`classic.Stop`, `plugin.register`, `prompt.submit`) em `.claude-tmp/gm15-t0b/`.

## Criado
`.claude-tmp/gm15-t0b/{cfg,home,cwd}` (vazios exceto `cfg` com estado de 1 chamada sem login). Nada removido.
