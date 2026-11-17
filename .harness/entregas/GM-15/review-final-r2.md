APROVADO r2 blocker=0 major=0 minor=6
Review final GM-15 (2.1.0) rodada 2 · diff origin/next...518bbe9d (PR #25, head publicado 518bbe9d, 199 arquivos) · revisor adversarial · 2026-11-17
CI lida: run 44123901828, headSha 518bbe9d03f45c44d1f04e238516c1d15a4c39bf, status completed, conclusion success (`gh run view` e `gh pr checks 25`): 11 de 11 checks pass, entre eles "gates — node --test (mjs + ts)" 10m5s e "mod — claude plugin test" 1m42s (passo sob o teto de 168 s). PR MERGEABLE.
BLOCKER-1 r1 FECHADO: CI verde no head publicado; aceite-gm15.test.mjs:61-66 não exige refs/heads/<branch> com HEAD destacado (mutação M5 morta); teto do mod em .github/workflows/ci.yml:39 (MOD_TEST_TIMEOUT=168).
MAJOR-1 r1 FECHADO: costura r1 reexecutada pelo CLI real em cópia sem git (zz-a.mjs, zz-a2.mjs). Teto que a Sombra decide (1º, 2º e 3º teto): proxima=parar teto_rodadas com oferecer=true e lote=[], painel sem item da T1 e parar=null, Stop devolve decision=block pedindo `sombra.mjs perguntar --task T1 --libera-teto` (stop-loop.mjs:100-105, :630-633), sem "parou" nem /liberar. 4º teto (freio, 2 abordagens): lote e DEPENDE com "decidir a T1", Stop avisa "parou ... comando do dono". loop.parar{teto_rodadas,T1} legado: Stop bloqueia pelo aprendizado pendente e, fechada a pendência, pede a pergunta à Sombra (stop-loop.mjs:601-607); a Sombra libera e proxima=despachar. Mod não grava loop.parar quando a Sombra decide (mod/gabarito.mjs:459; M7 morta).
Costura nova T38×T39×T36 (zz-r2.mjs na cópia): (1) parar legado + pendência fechada + flag em origin ⇒ Stop pede a Sombra, liberar ok, despachar; (2) flag só na config local commitada, sem origin ⇒ proxima libera_teto_desligado, item do dono no lote e no DEPENDE, Stop "parou"; (3) origin desligado e local ligado ⇒ igual a (2). proxima, painel e Stop concordam nos 3.
Mutações (7 aplicadas, 6 mortas, 1 equivalente; cópia restaurada a cada uma; checkout intocado, `git diff --stat` só mostra .harness/aprendizados.jsonl, que já estava modificado antes do review):
M1 Stop lê a config LOCAL em vez de origin ⇒ morta (t39-r1-stop-config-local-ligada-origin-desligada-nao-conta)
M2 Stop ignora o freio (só a flag) ⇒ morta (t39-stop-freio-cita-liberar)
M3 Stop volta a silenciar depois do loop.parar do teto ⇒ morta (t39-r1-stop-loop-parar-teto-com-sombra-decidindo-nao-silencia)
M4 Stop não converte a ação em sombra_decide_teto ⇒ morta (3 testes t39)
M5 aceite: foto exige refs/heads/<branch> ⇒ morta (aceite-foto-do-checkout-funciona-com-HEAD-destacado)
M6 dist/loop.js liberaTetoDeOrigin aceita qualquer fonte ⇒ viva nos testes t39 do Stop, mas equivalente nesse nível: lerConfigOrigin (lib/config.mjs:146-155) só devolve fonte 'origin' ou 'nenhuma' com cfg null; a regra é travada em src por loop.test.ts t39-libera-teto-de-origin e o dist pelo check "dist em dia". Não é achado.
M7 mod grava loop.parar mesmo com a Sombra decidindo (gabarito.mjs:459) ⇒ morta (t39-mod-sombra-decide-teto-nao-grava-parar; `claude plugin test .`: 580 pass, 1 falha real + 42 "did not load")
MINOR r1 reavaliados (nenhum arquivo deles mudou em 84e0e7a9..518bbe9d):
MINOR-1 ABERTO spec versionada sem as emendas aprovadas (fluidez-design.md:81 e :85 contradizem o entregue).
MINOR-2 ABERTO loop.ts:583 freio conta abordagem_nova repetida (medido de novo no zz-a: "dividir a task" 2 vezes esgota).
MINOR-3 ABERTO registro.ts não mostra a abordagem_nova da liberação.
MINOR-4 ABERTO (suspeita) spec divergente despacha só com aviso.
MINOR-5 ABERTO publicada × encerrada: CLI recusa e proxima manda despachar logo depois do merge da PR.
MINOR-6 FECHADO (era do brief do review; o brief da r2 já manda TMPDIR fora do checkout e cópia sem git).
MINOR-7 NOVO .claude-tmp/gm15/backlog-2.1.1.md não lista os MINOR-1 a 5 do review final r1 (só os de task); ficam só em .harness/entregas/GM-15/review-final-r1.md. Levar ao backlog 2.1.1.
Limite observado: `git ls-remote` e `git archive` foram negados pela guarda a subagent ("integridade em .git"); o head remoto foi lido por `gh pr view 25 --json headRefOid` (518bbe9d) e a cópia foi feita por cp do checkout (HEAD 518bbe9d, plugins sem alteração local).
Os 4 MINOR do review de task T39 r2 seguem no backlog; não reabertos aqui.
