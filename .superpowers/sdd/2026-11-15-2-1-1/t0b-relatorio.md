# Relatório T0b (GM-15), 2026-11-15: spikes S4, S5, S8. sessões reais `-p` com a config da conta (autorização do dono)

Método: claude 2.1.325. Passo 2 (autorizado pelo dono, 2026-11-15): 12 sessões `claude -p --model claude-haiku-5-5 --setting-sources project --strict-mcp-config --max-turns 4..6` com `CLAUDE_CONFIG_DIR` da conta, cwd `.claude-tmp/gm15-t0b/repo` (pasta de brinquedo sem repositório: a inicialização foi barrada pelo hook de integridade e não contornei), mod de sonda `--plugin-dir .claude-tmp/gm15-t0b/plug` só observando; dados em `out/{i,w,s}<k>/`. Efeitos: 12 sessões no diretório de projetos da conta para esse cwd; settings da conta intactos. A parte sobre credencial vale só para a tentativa isolada (1). (1) Tentativa de sessão real com config e HOME isolados em `.claude-tmp/gm15-t0b/{cfg,home}` (A6): `claude -p "responda ok"` => "Not logged in · Please run /login" (1/1). Sem `ANTHROPIC_API_KEY` nem `CLAUDE_CODE_OAUTH_TOKEN` no ambiente (checado só por nome). Copiar credencial da conta seria ler segredo (regra 1), então não fiz. Usar a config da conta (como a T0b da GM-14, efeito colateral E21: sessões gravadas em `~/.claude-conta2/projects`) não está autorizado neste brief: PAREI aí. (2) `gh secret list` (leitura, só nomes): 0 segredos de Actions. (3) Leitura dos tipos da plataforma (`claude-code.d.ts` desta build) e do relatório T0b da GM-14.

| Spike | Número | Veredito | Consequência |
|---|---|---|---|
| S4 (i) mod lê a versão carregada e compara com o disco | 3/3 sessões `-p` reais: o mod guarda a versão lida no `session.start` (`memv` = 0.1.0) e, com o `plugin.json` do disco mudado no meio da sessão (0.2.1, 0.2.2, 0.2.3), o `classic.Stop` e o `turn.complete` leram `disco` diferente de `memv` 3/3; sem mudança `memv` = `disco` 4/4 (controle). Mesma carga do módulo (sem reload) 3/3. `plugin.register` não disparou para o próprio mod (0/3); `$.plugin` só admite `.name`/`.root` | CONFIRMADA (com ressalva) | T20: doctor/mod compara versão capturada na carga com a do disco. Ressalva: a "memória" é a leitura do mod no `session.start`; um hot-reload do módulo a refaz (não medido em pty); `-p` não recarrega |
| S4 (ii) detectar wakeup armado | 3/3: após `ScheduleWakeup` (sentinela `<<autonomous-loop-dynamic>>`, 300 s), `Stop.session_crons` = 1 item `{id, schedule (hora do disparo), recurring: false, prompt: "<<autonomous-loop-dynamic>>"}`; controle sem wakeup: `session_crons: []` 7/7. Ligar `/loop` pelo mod: sem API (tipos); não medido | CONFIRMADA (detectar); ligar: REFUTADA só por tipos | Sinal de T17: item em `classic.Stop.session_crons` com `prompt` = `<<autonomous-loop-dynamic>>` e `recurring: false`; sem item = ausente; campo ausente ou não array = "não conferível". Ligar o loop: só o aviso (plano B) |
| S5 `background_tasks` de shell com `integrar` | 3/3: `run_in_background` real, `description` "integrar T<k> em fundo" => no Stop `background_tasks:[{id, type:"shell", status:"running", description, command}]` 3/3, campos íntegros; Stop final com `[]` 3/3 (~31 s depois) | CONFIRMADA | T16: casar `type==='shell'`, `status==='running'` e `integrar`/`gate-task` em `description` ou `command` (a `description` vem do modelo) |
| S8 `/clear` real no CI | Credencial: 0 segredos de Actions (`gh secret list` vazio), `ci.yml` sem `ANTHROPIC`/`secrets.`. Pouso, `/clear` e retomada local em pty: N = 0 (não rodado; exige o mod do gabarito e sessão interativa) | REFUTADA para o CI; retomada local NÃO MEDIDA | Plano B do POU-3 (T20): par simulado e prova local por release |

## Não mede
- Qualquer comportamento de sessão real (S4 i/ii, S5 `integrar`, retomadas e contexto do S8). Tipos provam presença, nunca ausência nem comportamento.
- Se há como fornecer credencial ao CI sem segredo de Actions (fora do repo).

## Desvios
- Pasta de brinquedo sem repositório. A edição de `plugin.json` pelo modelo foi barrada pelo guarda (arquivo sensível); a mudança no disco foi feita por mim, de fora da sessão, 7 s depois do início.

## Antigo pendente (superado pela autorização)
Autorizar sessão real com a config da conta em cwd isolado (precedente GM-14 T0b, E21) ou fornecer credencial isolada (`ANTHROPIC_API_KEY` só para o spike); então rodar 3 sessões com mod de sonda (`classic.Stop`, `plugin.register`, `prompt.submit`) em `.claude-tmp/gm15-t0b/`.

## Criado
`.claude-tmp/gm15-t0b/{cfg,home,cwd}` (vazios exceto `cfg` com estado de 1 chamada sem login). Nada removido.
