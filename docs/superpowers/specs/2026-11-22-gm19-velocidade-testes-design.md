# GM-19: velocidade e qualidade dos testes

Iniciativa: não vinculado (D-G39) · Epic: não vinculado (D-G39) · PBI: GM-19 (Enabler) · Versão: sem versão nova (D-G38) · Data: 2026-11-22 · Base: `enabler/GM-19-velocidade-testes` bfa322ad
PBIs conhecidos, na ordem da D-G30: GM-18 (Enabler, entregue na 2.2.1) · **GM-19** (Enabler, esta entrega) · GM-17 (promoção de aprendizado, reservada pela D-G25).

**STATUS: ~~r1~~ r2, conforme; Q1 a Q4 respondidas (D-G36 a D-G39). Aguarda `/gabarito-mestre:aprovar`.**
- **O que o sistema faz hoje:** a suíte de `gates` leva ~490 s nesta máquina e 701 s de mediana na CI. Há 3 furos de proteção (F11 a F13) e 5 repetições confirmadas por leitura (F16).
- **O que está escrito que fará:** tudo a partir de "Decisões". Nada disso foi executado.
- A D-G35 só autoriza abrir. Spec, merge em `main` e release dependem do dono.

_(Emenda 2026-11-22, r2, conformidade r1 `.claude-tmp/gm19/conformidade/r1.md`, 5 faltas. F-1: as durações saíam de `soma_top/2`, válido só para 5 dos 125 arquivos; agora vêm do JUnit, nível 0: soma ~~1719~~ 2419 s, git-leitores ~~67,5~~ 135,8 s, hoje no modelo ~~463~~ 484 s, com loop-cli dividido ~~236~~ 241 s, os 3 divididos ~~148~~ 202 s, avaliar-* ~~4,8~~ 10,4 s. F-2: sai a previsão da CI em segundos (~~582 s~~). F-3: entra REQ-RED-1. F-4: a prova de linhas preserva a ordem e ganha MS-f. F-5: velocidade fica só em loop-cli, sai o REQ-VEL-2, meta ~~240~~ 300 s. Perguntas ao dono: ~~7~~ 4; as outras 3 viram DS9 a DS11.)_

**Objetivo (dono, literal, D-G35):** "otimizar seria o melhor caminho para ganharmos tempo e qualidade de forma segura, sem over engineer e excesso de testes de forma redundante".
**Desenho em uma frase:** dividir 1 arquivo sem mudar teste, fechar 3 furos e cortar o que repete, com prova por mutação.
Para cada task esperar menos no `integrar`, precisamos que `loop-cli` deixe de decidir o relógio da suíte.
Fontes: `2026-11-22-gm19-decisoes-dono.md` (D-G35); `.claude-tmp/gm19/medicao.md` (a seção "CORREÇÃO" vence as §2 e §5) e logs ao lado; `.claude-tmp/gm19/conformidade/modelo.py`; `.claude-tmp/gm19/auditoria.md`; `docs/aprendizados/processo-orquestrador.md` (P5, P8, P9, P16, P18, "Testes instáveis sob carga", "Golden S6", "Duração derivada"). `.claude-tmp/proxima-velocidade/ideia.md` é insumo e perde para a medição de hoje.

Legenda: **(a, medido)** número de log ou comando de 2026-11-22 · **(a, lido)** conferido no arquivo ou na configuração · **(b)** documentado por terceiro, não medido aqui · **(c)** escolha do redator, reversível · **(M, calculado)** conta sobre medição, não é fato · **(M, a medir)** falta medir. Decisões e requisitos são (c), salvo marca na linha. Caminhos relativos a `plugins/gabarito-mestre/`, salvo `.github/`, `docs/`, `.claude-tmp/` e `harness.config.json`.

## Fatos (2026-11-22, só leitura e medição local; nenhum terceiro alterado)
- F1 (a, medido) Suíte: 489,9 e 490,8 s de relógio, 1995 s de CPU. Com a máquina ocupada, 655,1 s. Logs `run1` a `run3`. 16 núcleos, Node 24.14.1, load1 de 5,0 a 9,2 antes das execuções. A máquina não estava quieta.
- F2 (a, medido) 5783 testes: 5772 pass, 1 fail, 1 skip, 9 todo. O fail é `s6-gabarito-zero-errado: separatrue`, conhecido. A CI o pula.
- F3 (a, medido, JUnit nível 0 da run 3) `loop-cli` 438,2 s · `fumaca-loop` 231,5 · `conversa-pontos` 219,0 · `git-leitores` 135,8 · `anel-worktree` 129,7 · `kill-switch` 108,4 · `onboarding` 98,6 · `entrega-cli` 97,9. Os 125 arquivos somam 2419 s. O 1º dura 89 % do relógio.
- F4 (a, medido, run 3) Em `loop-cli` (441 testes), o maior bloco indivisível leva 89,5 s e o maior teste 11,3 s.
- F5 (a, medido) Já há disputa: `git-leitores` leva 58,5 s isolado e 135,8 na suíte (2,3 vezes); `anel-worktree`, 58,6 e 129,7. `fumaca-loop` já roda 4 cenários por vez (`gates/test/fumaca-loop.test.mjs:89`) e usa 599 s de CPU em 186 s.
- F6 (a, medido) O multiconjunto "caminho de `describe` > nome do teste | estado" é idêntico nas 3 execuções, inclusive na de 655 s: 5783 linhas, mesmo sha.
- F7 (a, lido) O `integrar` chama `avaliar` (`gates/scripts/loop.mjs:1113`), que lê as suítes da config da worktree da task (`gates/scripts/gate-task.mjs:186`, `:279`). `gates` e `hooks` rodam juntas e o mod depois (`:280-288`). O corte já acelera o gate da própria task. (a, medido) O mod leva 34,4 s, `texto` 1,1 s, hooks 3,4 s.
- F8 (a, medido, diário da GM-18) Do veredito aprovado à integração: T1 19,2 min (1 integrar perdido no S6), T2 8,9, T3 9,1, T4 9,0. São 46 dos 121 min entre o 1º despacho e a última integração.
- F9 (a, medido) CI, 10 execuções verdes: job `gates` com mediana 701 s (532 a 811), dominante em 10 de 10. `npm test` é ao menos 97 % dele.
- F10 (M, calculado de microbenchmark medido) Repo-molde dá ~6 % no `loop-cli` e ~1,5 % da CPU da suíte (medição §4). Refutado como alavanca.
- F11 (a, lido; formato em log gravado) `scripts/test/mod-test.sh:20-22` só vigia `gabarito.test.ts` e ignora todo "the file did not load". `mod/test/chat.test.ts` que não carregar passa verde. A saída real traz `<caminho>.test.ts:` antes do "did not load" (`.claude-tmp/t60rev-mod-base.log`).
- F12 (a, lido) `scripts/test/texto-nom.test.sh` não é chamado por CI, gate nem outro script.
- F13 (a, lido) Os globs de `npm test` não são recursivos. `gates/test/package.test.mjs:156-157` confere só o `test:mjs`. O único teste em subpasta hoje é fixture: `e2e/repo-exemplo/test/base.test.mjs`.
- F14 (a, lido por `gh api`) O ruleset de `main` exige 8 dos 11 jobs. Faltam `mod`, `dist em dia` e `versao-medida`, que é aviso por desenho (`.github/workflows/ci.yml:130-147`).
- F15 (a, lido) `fumaca-e4:188`, `fumaca-e5:253` e `fumaca-gm14:357` varrem o tmp. Suítes simultâneas precisam de TMPDIR distinto.
- F16 (a, lido) Dos 6 itens da auditoria §1B, 5 repetem o que outro teste já afirma, com a mesma entrada (tabela de REQ-RED-1).
- F17 (a, medido em cópia do script com saída falsa) O 6º item **não é redundante**. Com a mutação "confiar no rc 0" em `mod-test.sh`, os casos de `gates/test/package.test.mjs:105-108` seguem com rc 1, porque o `claude` falso sempre sai 1. Os 2 casos de `gates/test/painel-modtest-timeout.test.mjs:30-33` passam a dar rc 0: só eles pegam a mutação.

## Previsão local (M, calculado; não é fato)
Modelo `modelo.py`: JUnit nível 0, ordem alfabética, 15 vagas. (b) O runner usa `availableParallelism() - 1` vagas. A ordem de início e a disputa nova de CPU não foram medidas.

| Estado | run 3 | run 2 |
|---|---|---|
| hoje (medido: 491 e 490) | 484 s | 483 s |
| só `loop-cli` em 5 (esta entrega) | 241 s | 243 s |
| também fumaça e conversa-pontos em 2 (fora, Q1) | 202 s | 205 s |

Para a CI não há previsão em segundos: o modelo não reproduz a mediana medida de 701 s e os núcleos do runner não foram medidos.

## Decisões (c; não reabrir sem fato novo)
- **DS1 Dividir por mover bloco inteiro, na ordem atual.** A 1ª parte mantém o nome; as outras são `-2` a `-5`. Os auxiliares de topo vão inteiros para `gates/test/_loop-cli-helpers.mjs`, fora do glob. Rejeitado: filtro por variável, porque filtro errado pula teste em silêncio. Rejeitado: concorrência interna ou `--test-isolation=none`, porque a suíte tem testes que mudam o estado do processo (auditoria §3d).
- **DS2 Só `loop-cli`, em 5 partes.** Fonte: F3, F4 e previsão. Rejeitado: dividir também fumaça e conversa-pontos, porque poupa mais ~39 s e dobra os processos da fumaça sobre uma disputa que já chega a 2,3 vezes (F5). Fica na Q1 e no backlog.
- **DS3 Medir antes de integrar, com regra escrita (REQ-VEL-1).** Rejeitado: integrar e medir no fim, porque dividir nunca foi executado.
- **DS4 Tempo é aceite medido pelo orquestrador, nunca asserção.** Rejeitado: teto de relógio em teste ou gate, porque falha por carga (F1: +34 %).
- **DS5 Igualdade por JUnit do Node e por faixa de linhas do original, em comandos de 1 bloco.** Rejeitado: `diff` com `sort`, porque não vê linha trocada entre testes (a, medido: rc 0). Rejeitado: script versionado, porque é infraestrutura de um uso.
- **DS6 `texto.test.sh` chama `texto-nom.test.sh`.** Rejeitado: job ou suíte nova, porque mexe em CI, config e nome de job.
- **DS7 O mod só tolera "did not load" sob cabeçalho `gates/test/`.** Rejeitado: listar arquivos pelo nome, porque o próximo repete o furo.
- **DS8 Dividir, fechar furo e cortar são 3 tasks em sequência. Só sai o que a mutação provar coberto.** O item de F17 fica. Rejeitado: cortar junto da divisão, porque a prova de igualdade deixaria de valer. Rejeitado: ampliar `package.test.mjs` para poder cortar o de F17, porque é trocar um teste por outro.
- **DS9 Testes históricos ficam na suíte de toda task** (aprovada pela Sombra, 8fe49b6d). (M, calculado) Depois da divisão, tirar `conversa-pontos` poupa ~1 s e tirar `avaliar-*`, ~1 s. (a, medido) `avaliar-*` somam 10,4 s, em paralelo com o resto. Rejeitado: tirar, porque perde 221 e 64 testes por task sem ganho de relógio.
- **DS10 Sem gate por impacto no `integrar`** (aprovada pela Sombra, 8fe49b6d). (M, calculado) Depois da divisão pouparia no máximo ~4 min por task. Rejeitado: criar, porque exige seleção de testes e o gate inteiro já pegou defeito de junção (processo, E4 onda 1).
- **DS11 A CI segue rodando no push de `next` e no PR** (aprovada pela Sombra, 8fe49b6d). (a, medido) 4 shas das últimas 100 execuções rodaram 2 vezes, em paralelo e em repositório público. Rejeitado: cortar um dos 2, porque o PR testa o resultado do merge.

ADRs: nenhuma. Não há exceção a regra.

## Requisitos
**Condição de medição (P5).** Esta máquina (16 núcleos, Node 24), worktree limpa, nenhum agente testando, nenhuma outra suíte, `load1 ≤ 8` antes de cada execução. 3 execuções válidas, vale a mediana. Carga fora da condição invalida a execução e não reprova. Sem 3 válidas em 5 tentativas, o resultado é "não medido" e o orquestrador mede mais tarde. S6 é o único vermelho aceito. De `gates/`, com `<J>` absoluto em `.claude-tmp/gm19/`:
```bash
/usr/bin/time -p node --experimental-strip-types --test --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=junit --test-reporter-destination=<J> test/*.test.mjs test/*.test.ts
```

**REQ-SEG-1 Dividir não muda nenhum teste (invariante).** _(Emenda 2026-11-22, r2, F-4: prova B.)_
- Dado o JUnit da base (`.claude-tmp/gm19/run3.junit.xml`) e o da branch, Quando a prova A roda, Então sai 0: mesmos caminhos, nomes, repetições e estados, e iguais `tests`, `pass`, `fail`, `skipped`, `todo`, `cancelled`.
```bash
nomes() { python3 -I -c 'import sys,xml.etree.ElementTree as T
def v(e,p):
  for x in e:
    if x.tag=="testsuite": v(x,p+[x.get("name")])
    elif x.tag=="testcase": print(" > ".join(p+[x.get("name")]).replace("\n"," "),"|",next((y.tag+":"+(y.get("type") or "") for y in x if y.tag in("skipped","failure")),"pass"))
v(T.parse(sys.argv[1]).getroot(),[])' "$1" | LC_ALL=C sort; }
contas() { grep -oE '<!-- (tests|pass|fail|cancelled|skipped|todo) [0-9]+ -->' "$1"; }
diff <(nomes "$BASE") <(nomes "$NOVO") && diff <(contas "$BASE") <(contas "$NOVO")
```
- Dado o original da base em `$O` e, em `gates/test/`, o helper e as 5 partes, cada um com `// --- corpo movido ---` logo depois dos import (1 por linha) e dos comentários `//`, Quando a prova B roda, Então sai 0: cada linha do corpo está igual e na mesma ordem. A única diferença aceita é `export ` no helper.
```bash
M='// --- corpo movido ---'; H=_loop-cli-helpers.mjs; P=(loop-cli.test.mjs loop-cli-{2,3,4,5}.test.mjs)
esperado() { sed -n '26,195p' "$O"; sed -n '3163,3231p' "$O"; sed -n '196,3162p' "$O"; sed -n '3232,$p' "$O"; }
corpo() { sed "1,\\|^$M\$|d" "$1"; }
novo() { corpo "$H" | sed 's/^export //'; for f in "${P[@]}"; do corpo "$f"; done; }
cabecalho() { for f in "$H" "${P[@]}"; do sed "\\|^$M\$|,\$d" "$f" | grep -Ev "^(import .* from '[^']+';|//.*)?\$" && return 1; done; return 0; }
cabecalho && diff <(esperado) <(novo)
```
- Dado um arquivo novo que não carrega, Quando a suíte roda, Então o rc é diferente de 0 e o arquivo é nomeado.
- Mutações, cada uma com quem a derruba: MS-a apagar 1 teste ⇒ A · MS-b `test.skip` em 1 teste ⇒ A · MS-c tirar uma parte do glob ⇒ A · MS-d trocar 1 asserção ⇒ B · MS-e `throw` numa parte ⇒ rc da suíte · MS-f trocar de lugar 1 linha entre 2 testes ⇒ B · MS-g código executável antes do marcador ⇒ B.
- (a, medido) B provada em `.claude-tmp/gm19/prova-linhas/`: intacto rc 0; MS-f na mesma parte e entre partes rc 1; MS-g rc 1; nos cortes reais, sem executar teste, intacto rc 0 e MS-f rc 1.

**REQ-VEL-1 `loop-cli` em 5 partes; meta local de mediana ≤ 300 s (D-G36).** _(Emenda 2026-11-22, r2, F-5.)_
- Corte, por linha de bfa322ad: helper = `26-195` + `3163-3231` · 1 = `196-1587` · 2 = `1588-2834` · 3 = `2835-3162` + `3232-4815` · 4 = `4816-5635` · 5 = `5636-6925`. (a, medido, run 3) 105, 100, 95, 91 e 46 s de testes.
- Dado o corte com REQ-SEG-1 verde, Quando medido na condição, Então a mediana cai de ~490 para **≤ 300 s**, com 0 vermelho novo. (M, calculado) Esperado ~241 s. 3 min não é prometido.
- Dado o resultado, Quando o orquestrador decide, Então:
  - acima de 417 s (ganho < 15 %) ⇒ não integra, o dono recebe o número e a dependência da T2 sai por emenda;
  - até 417 s ⇒ integra; se passou de 300 s, declara meta não atingida. Nenhum outro arquivo é dividido.
- Dado um vermelho novo, Quando aparece na suíte dividida, Então roda isolado 3 vezes (processo, "Testes instáveis sob carga"). Se repete só na suíte dividida, o corte não integra. Timeout não aumenta.
- Mutação: MV1-a partes juntas de novo ⇒ mediana acima de 417 s. É a própria base (F1), sem execução nova.

~~REQ-VEL-2 Meta local com 2º corte.~~ _(Emenda 2026-11-22, r2, F-5: retirado; ver DS2 e Q1.)_

**REQ-VEL-3 CI: não piora. Sem previsão em segundos.** _(Emenda 2026-11-22, r2, F-2.)_
- Dado o PR para `next`, Quando o job `gates` roda 3 vezes no mesmo sha, Então as 3 saem verdes, a mediana é ≤ 811 s (o pior medido, F9) e `tests` é igual ao local. O relato compara com a mediana de 701 s.
- Tolerância: 1 execução acima de 811 s não reprova, vale a mediana. Mediana acima ⇒ mais 2 execuções. Se mantiver, o número vai ao dono antes do merge. Comando: `gh run view <id> --json jobs` e o resumo `tests N` do log.
- Nomes de job não mudam: presos pelo ruleset (F14) e, em parte, por `scripts/test/texto.test.sh:326-338`.
- Mutação: MV3-a job com `npm run test:mjs` ⇒ `tests` menor que o local.

**REQ-FURO-1 Arquivo do mod que não carrega reprova.**
- Dado cabeçalho fora de `gates/test/`, ou nenhum, seguido de `(fail) the file did not load`, Quando `mod-test.sh` avalia, Então sai 1. Só com arquivos de `gates/test/` sem carregar, segue saindo 0. As 3 regras atuais ficam.
- Teste: `mod-test-outro-arquivo-nao-carrega` (chat, pedaço novo, sem cabeçalho, mod depois de gates). O caso "só os de gates" de `gates/test/package.test.mjs:104` ganha o cabeçalho real.
- Mutações: MF1-a remover a regra · MF1-b aceitar qualquer `/test/` · MF1-c aceitar falha sem cabeçalho. As 3 caem no teste novo. Prova real: import quebrado em cópia de `chat.test.ts` ⇒ rc 1.

**REQ-FURO-2 `texto-nom.test.sh` passa a rodar.**
- Dado um caso falhando no filho, Quando `texto.test.sh` roda sem argumento, Então sai 1. Com `--nom` ou `--fase` sai antes (`:63`, `:75`), sem recursão. (M, a medir) Se o filho está verde hoje e quanto custa.
- Teste: `texto-nom-e-chamado-pelo-texto`, que fixa a linha `check` com a chamada e o rc.
- Mutações: MF2-a apagar a chamada ⇒ teste novo · MF2-b engolir o rc ⇒ teste novo · MF2-c inverter 1 caso do filho ⇒ `texto.test.sh` rc 1.

**REQ-FURO-3 Nada sai dos globs.**
- Dado `gates/package.json` e a árvore de testes, Quando `package.test.mjs` roda, Então `scripts.test` é exatamente o comando de hoje e nenhuma subpasta tem `*.test.mjs` ou `*.test.ts`, salvo a fixture de F13.
- Teste: `npm-test-cobre-todo-arquivo-de-teste`.
- Mutações: MF3-a tirar o glob `.ts` · MF3-b plantar `test/sub/x.test.mjs` · MF3-c liberar `e2e/` e plantar ali. As 3 caem no teste novo.

**REQ-RED-1 Cortar o repetido, só com prova.** _(Emenda 2026-11-22, r2, F-3.)_
- Dado R1 a R4 ou R6, Quando o implementador aplica a mutação, roda o teste que fica (no mod, a suíte do mod), vê falha de asserção nele e restaura, Então pode remover. Se esse teste não cair, ou só falhar ao carregar, o item **não sai** e vai no relato. Linhas de bfa322ad; depois da T2, localizar pelo nome.

| Item | Sai | Fica e tem de cair | Mutação temporária |
|---|---|---|---|
| R1 | `mod/test/gabarito.test.ts:1106` `evento-pouso-nao-gravou` | `:3676` `falha-antes-do-clear-sem-pouso-diario` (corpo idêntico) | MR1: `mod/gabarito.mjs:237` ignora a falha do `gravar` |
| R2 | `gates/test/autonomia-processo.test.mjs:104` `sem-arquivo-ask-continua-ask` | `:58` `so-config-sem-interruptor-ask-no-processo` (corpo idêntico) | MR2: `gates/dist/guarda.js:671` troca o `&&` por `\|\|` |
| R3 | `gates/test/package.test.mjs:128` `version do plugin.json igual` | `:52-54` `versao-manifestos` (mesma igualdade e skip) | MR3: versão 9.9.9 só no `plugin.json` |
| R4 | `gates/test/package.test.mjs:83-87` teto de 95 linhas | `gates/test/harness-doctor-loop.test.mjs:369` teto de 80 (mesma skill e conta, sem skip) | MR4: skill `gabarito-loop` com 96 linhas |
| R5 | **nada** (F17) | os 2 casos de `gates/test/painel-modtest-timeout.test.mjs:30-33` ficam | MR5: `mod-test.sh` confia no rc 0 ⇒ só eles caem |
| R6 | 2 linhas, `gates/test/package.test.mjs:73-74` (asserção; o teste fica) | `gates/test/skills-shell.test.mjs:371` (mesmo literal e arquivo) | MR6: trocar `descricao:` em `gates/scripts/loop.mjs:1576` |

- Dado os 5 cortes feitos, Quando `nomes` compara antes e depois, Então só somem R2, R3 e R4 em gates e R1 no mod, nenhum nome entra e nenhum estado muda. Contagem por suíte:

| Suíte | Base | Depois da T1 | Depois da T2 | Depois da T3 |
|---|---|---|---|---|
| gates, `tests` / `pass` | 5783 / 5772 | 5783 / 5772 | 5786 / 5775 | 5783 / 5772 |
| mod, testes carregados | 581 (a, log de 2026-11-17; confirmar na T3) | igual | igual | base − 1 (580) |
| hooks | 76 | 76 | 76 | 76 |

Permissão: nenhum REQ cria comando, evento ou caminho de escrita. A guarda e os papéis não mudam.

## Testes e gates
| REQ | Task | Prova | Mutações |
|---|---|---|---|
| REQ-SEG-1 | T1 | provas A e B e prova negativa | MS-a a MS-g |
| REQ-VEL-1 | T1 | 3 execuções e regra de integrar | MV1-a |
| REQ-VEL-3 | T1 | 3 execuções da CI no PR | MV3-a |
| REQ-FURO-1 a 3 | T2 | 3 testes novos e prova real do mod | MF1 a MF3 (9) |
| REQ-RED-1 | T3 | o teste que fica vermelho antes de cada corte; contagens | MR1 a MR4 e MR6; MR5 prova o que fica |

Não cortar (auditoria §4): corpus núcleo × adaptador real e matriz de modo, anel, kill-switch, autonomia (salvo R2, corpo idêntico), guarda-adaptador, hash chain, pares núcleo × CLI, entrypoint-guard, fumaças sem LLM (P9), matriz ubuntu/macOS.
Aprendizados D para spec: GM-14 seq 143 (fumaça pelo adaptador real fica; furo do mod tem prova real) e seq 139 (tasks com teste comum em sequência) tratados. Seq 140, 141, 142 e 387 não se aplicam: não há render, estado novo nem aceite de clareza.

## Perguntas ao dono (4, respondidas em 2026-11-23: a recomendação em todas, D-G36 a D-G39)
- **Q1 Meta e escopo de velocidade.** Recomendo só `loop-cli`, com mediana local ≤ 300 s (esperado ~241) e CI sem piora. (M, calculado) Nas 5 integrações de uma GM-18 são ~21 min a menos de 121. Se não: dividir também fumaça e conversa-pontos dá ~202 s calculado (mais ~3 min por entrega dessas), com mais disputa de CPU e 1 task a mais.
- **Q2 Jobs exigidos na `main`.** Recomendo exigir `mod` e `dist em dia` (8 ⇒ 10 de 11) e deixar `versao-medida` como aviso. Os 2 já rodam em paralelo e medem 92 e 7 s de mediana. É ato do dono no ruleset. Se não: PR com esses 2 vermelhos segue podendo mergear.
- **Q3 Versão.** Recomendo sem versão e sem virada própria: fica em `next` e chega à `main` com a próxima release, para a `main` não ter conteúdo novo na mesma 2.2.1. (a, lido, `gates/src/trilha.ts:174-178`) Consequência: a GM-19 só encerra sozinha se o PR daquela release casar o ID; senão, por `/gabarito-mestre:encerrar`. Se não: task de virada 2.2.2 por emenda, com PR e release por ordem do dono.
- **Q4 Vínculo.** Recomendo seguir sem Iniciativa e Epic, como na GM-18 (D-G33), e vincular por `gabarito-instalar --vincular GM-19` depois. Se não: ele informa os IDs e o cabeçalho muda.

## Fora de escopo (dono: Gabriel; as linhas novas vão ao backlog na T2)
| Item | Motivo | Gatilho |
|---|---|---|
| 2 defeitos do painel | D-G35, já no backlog | o gatilho de lá |
| GM-17 e Horizon | outra entrega | ordem do dono |
| Golden S6 | já no backlog, com contorno no processo | o gatilho de lá |
| Dividir fumaça e conversa-pontos | ~202 s calculado, com mais disputa (DS2) | dono escolher na Q1, ou mediana da suíte passar de 300 s depois da divisão |
| Testes históricos fora da suíte | ~1 s de ganho (DS9) | um deles virar o arquivo mais lento |
| Gate por impacto | DS10 | `integrar` voltar a passar de 8 min de mediana |
| CI duas vezes | DS11 | fila de runner medida atrasando PR |
| Esperas de `entrega-cli` ligadas a `gates/scripts/entrega.mjs` | a guarda negou a leitura na auditoria; não foi lido | spec que autorize esse escopo |
| Repo-molde | refutado (F10) | `git init` passar de 15 % de um arquivo lento |
| CLI em processo, CPU da suíte | muda o que o teste prova; ganho não medido | dono pedir meta de CI, começando por medir os núcleos |
| Suspeitas §1C | no máximo os 16,0 s do `describe` `ids e plano` | esse bloco virar gargalo |
| Outras esperas fixas, helpers copiados, tmp sem limpeza, `concurrency` sem efeito em `entrega-cli` | não decidem o relógio | o arquivo virar o mais lento, ou disco cheio |
| Suíte repetida nas skills de review e loop | contradiz P16, muda produto, custo não medido | 1 revisão medida com suíte inteira por mutação |
| `instalar.test.sh` só na CI | é job exigido (F14) | falha que só apareceu na CI |

## Rollout
1. Aprovação do dono, com Q1 a Q4, e DS9 a DS11 confirmadas pela Sombra. Motivo: a D-G35 não aprova spec.
2. T1, com S6 rodado na base antes do 1º `integrar`. Motivo: o gate seguinte já fica rápido.
3. T2, depois T3. Motivo: as duas tocam `package.test.mjs`, e o corte fecha a contagem no fim.
4. PR para `next` ao integrar o último código (P12) e aceite da CI. Motivo: a CI só se mede lá.
5. `main` com a próxima release (Q3). Ruleset por ato do dono (Q2). Motivo: R1.

Janela: sem mudança para quem usa o plugin. Volta: reverter o commit da task.

## Pendências
- Aprovação e Q1 a Q4: desbloqueia o dono. DS9 a DS11: desbloqueia a Sombra.
- (M, a medir) Tempo real dividido e disputa: T1. CI: PR. `texto-nom` e formato atual do mod quebrado: T2, passo 0. MR1 a MR4, MR6 e o total do mod: T3, antes de remover.
