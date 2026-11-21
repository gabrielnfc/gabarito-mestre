# Registro de decisões — GM-18

## Aprovação da spec

- 4a4035dc-9753-4829-946b-1f02728c1115:46 · spec docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md · sha256 99547b6c4b79791b1fd7df23d88b60e06778bdef390d9add11590b26a57b9ea8
- loop:43 · emenda #1 aplicada · spec docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md · sha256 99547b6c4b79791b1fd7df23d88b60e06778bdef390d9add11590b26a57b9ea8 ⇒ 16da2c4defe66e6670e79482e95f228437b18fdd8d8b2bd650ff66f48fb7d52b
- sha256 atual da spec: 16da2c4defe66e6670e79482e95f228437b18fdd8d8b2bd650ff66f48fb7d52b (confere com a aprovação + 1 emenda aplicada)

## Decisões da Sombra

- loop:7 · REQ-ENC-2 · 2.2.1 (patch). O dono decidiu na D-G30 patch sobre a 2.2.0, a confirmar na spec; a spec confirma no cabeçalho e na P1. 2.3.0 contraria a D-G30 e exigiria decisão nova do dono. · fontes: docs/superpowers/specs/2026-11-21-gm18-decisoes-dono.md:10, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:3, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:79, docs/superpowers/plans/2026-11-21-gm18-encerrar.md:90
- loop:8 · REQ-ENC-1 · Recusar nesta entrega: pr obrigatório em entrega.encerrada via dono; release citada pelo campo opcional versao junto com o PR. Encerrar só pela release fica fora de escopo, no backlog, gatilho 1ª entrega publicada sem PR mergeado. GM-13 (#1… · fontes: docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:30, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:72, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:80, docs/superpowers/specs/2026-11-21-gm18-decisoes-dono.md:6-7
- loop:9 · REQ-ENC-2 · Cita o PR #26 com versão 2.1.0 (/gabarito-mestre:encerrar GM-14 26 2.1.0). O #22 publicou a 2.1.0-alpha.1, pré-versão, que pela D-G14 não encerra; a D-G29 manda encerrar a GM-14 como 2.1.0, que saiu pelo #26. · fontes: docs/superpowers/specs/2026-11-21-gm18-decisoes-dono.md:5-7, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:21, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:81
- loop:10 · REQ-ENC-1 · Sim, pelo texto atual da spec, e só com via 'dono'. Pelo REQ-ENC-1 (d), em encerramentoDe uma entrega.encerrada com via 'dono' que venha depois da entrega.reaberta na ordem do diário vale mesmo que o PR já tenha sido usado e que o mergeado_… · fontes: docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:33, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:35, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:77, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:82
- loop:11 · REQ-ENC-2 · Pela spec, só confere que o PR está mergeado segundo o gh (number,state,mergedAt; REQ-ENC-2 f); recusas pr_nao_conferido e pr_nao_mergeado; mergeado_em = mergedAt. Sem checar base nem ID, porque #16 e #26 falhariam. Ressalva: P5 aberta, rec… · fontes: docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:40, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:41, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:43, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:83, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:77
- loop:12 · REQ-ENC-3 · Token posicional: cortar/adiar [<entrega>] <task> <motivo>, reabrir [<entrega>] <task>; 1º token é entrega só se casa ENTREGA_RE e vem seguido de task. Sem flag --entrega. Ressalva: P6 aberta, recomendação vale até a resposta. · fontes: docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:49, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:52, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:84, docs/backlog.md:60
- loop:41 · REQ-ENC-3 · APROVAR a emenda 1. Correção técnica dentro do escopo aprovado: REQ-ENC-3 serve para operar entrega que não é a da branch e as skills conferem o estado pelo CLI; sem --entrega, loop.mjs proxima e painel.mjs leem a da branch. Os scripts já a… · fontes: docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:94-115, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:81, docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md:49, plugins/gabarito-mestre/skills/cortar/SKILL.md:11-17, plugins/gabarito-mestre/gates/scripts/loop.mjs:40, plugins/gabarito-mestre/gates/scripts/painel.mjs:692

## Emendas

- #1 · REQ-ENC-3 · task T4 · tecnica · aprovada por sombra · fato: Review final r1 MAJOR-1: com <entrega> no argumento, as skills cortar/adiar/reabrir/encerrar conferem com loop.mjs proxima / painel.mjs sem --entrega (lê a entrega da branch); medido: cortar GM-11 T8 na branch GM-10 conferia a T8 da GM-10 · diff: --- .claude-tmp/gm18/spec-antes.md 2026-11-21 14:35:51 +++ docs/superpowers/specs/2026-11-21-gm18-encerrar-design.md 2026-11-21 14:36:04 @@ -107 +107 @@ -- iv. `USO` e as 3 skills (`skills/cortar/SKILL.md`, `skills/adiar/SKILL.md`, `skills/…

## Liberações de teto

- nenhum

## Desvios

- nenhum

## Descobertas

- loop:17 · tecnica · s6-gabarito-zero-errado: separatrue falha na base d9e5b7f3 sem a T1 (actual [master,staging] x golden [staging,master]); backlog l.71; CI pula. Gate local da GM-18 roda com S6_REPOS_DIR vazio, como o CI

## Aprendizados D

- loop:23 · E · Releitura defensiva antes de gravar (check-then-act) tem um teste por condição da releitura, com executor injetado que muda o diário durante a conferência; mutação que tira cada condição tem de morrer · entra em: instantaneo, brief:implementador · sem medição · eventos: loop:22 · gatilho: loop:22
- loop:33 · E · Passo pós-release (comando que o dono vai rodar) sai no backlog e no CHANGELOG com os valores já medidos na spec (PR, versão), nunca placeholder: o comando aceita qualquer PR mergeado e placeholder abre caminho para o PR errado · entra em: instantaneo, brief:implementador · sem medição · eventos: loop:32 · gatilho: loop:32
- loop:49 · E · Spec de comando do dono que aceita <entrega> explícita fixa também a conferência da skill (--entrega no proxima/painel); senão a skill relata a entrega da branch · entra em: instantaneo, brief:implementador · sem medição · eventos: loop:48 · gatilho: loop:48

## Aprendizados M

- loop:39 · A · Entrega pequena (3 tasks) fecha em ~4 h com spec em 3 rodadas: pergunta aberta sem fonte vai ao dono em 1 lote logo após a conformidade r2, não depois da aprovação · entra em: instantaneo · sem medição · gatilho: loop:38
