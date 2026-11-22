# GM-18 — decisões do dono

Numeração contínua com a GM-16 (`2026-11-19-gm16-decisoes-dono.md`, última D-G28).

- **D-G29 (2026-11-21, painel mostra entrega publicada como aberta):** fato trazido ao dono: o painel do projeto mostra `● GM-13 0 % (0 de 20)` e `● GM-14 98 % (57 de 58)`, embora a GM-13 tenha saído na 2.0.0 e a GM-14 na 2.1.0. Causa: só `entrega.encerrada` (gravado pelo `medir`, origem automática) conta como feito com `fluxo.ferramenta: clickup`; a GM-13 é anterior ao diário e o PR da GM-14 (#22) é pré-versão, que não encerra (D-G14). Backlog `docs/backlog.md` l.59 e l.60. Decisão do dono, literal "pode seguir, faz o encerrar primeiro" sobre a proposta do orquestrador:
  1. novo comando do dono `/gabarito-mestre:encerrar <entrega>`, espelho do `/gabarito-mestre:reabrir` (`gates/scripts/comando-dono.mjs`), que grava `entrega.encerrada` com origem do dono (comando humano), citando o PR ou a release que publicou a entrega;
  2. uso imediato: GM-13 encerrada como 2.0.0 e GM-14 como 2.1.0;
  3. `cortar`, `adiar` e `reabrir` ganham argumento opcional `<entrega>` validado (backlog l.60); sem argumento, o comportamento atual (entrega da branch);
  4. o diário nunca é editado à mão: o encerramento só entra pelo comando.
- **D-G30 (2026-11-21, ordem das entregas):** esta entrega (GM-18) vem primeiro, pequena; depois a da velocidade dos testes (GM-19, decidida pelo dono em 2026-11-16 antes do encaixe com o Horizon); a GM-17 continua reservada à promoção de aprendizado (D-G25). Versão: patch sobre a 2.2.0 (a 2.1.1 reservada na D-G24 foi absorvida pela 2.2.0 já publicada), a confirmar na spec.

## Respostas do dono depois da conformidade r2 (2026-11-21, AskUserQuestion)

- **D-G31 (DS8 / D6):** o 1º token de `cortar`, `adiar` e `reabrir` que casa `ENTREGA_RE` é **sempre** a entrega (opção recomendada; substitui a regra da r1 "seguido de task" confirmada pela Sombra seq 12).
- **D-G32 (D2, reduz o "PR ou release" da D-G29 item 1):** `pr` obrigatório no encerramento do dono; a release entra só como `versao` junto com o PR. Encerrar só pela release vai ao backlog (gatilho: 1ª entrega publicada sem PR mergeado).
- **D-G33 (fio condutor):** a GM-18 segue com Iniciativa e Epic **não vinculados**, declarado na spec; o vínculo fica para `gabarito-instalar --vincular GM-18` quando o dono quiser.
- **D-G34 (D4, D5):** fechadas como recomendado: depois de `entrega.reaberta` o dono pode encerrar de novo com o mesmo PR (só `via: dono`); o comando confere só "PR mergeado" pelo `gh` (`mergeado_em` = `mergedAt`), sem base nem ID no título.
