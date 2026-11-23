# Registro de decisões — GM-19

## Aprovação da spec

- 4a4035dc-9753-4829-946b-1f02728c1115:25 · spec docs/superpowers/specs/2026-11-22-gm19-velocidade-testes-design.md · sha256 1ebaf328739bd10c2ec26424a9330244dcd8b807f2b479c1ec3682345a26387f
- sha256 atual da spec: 1ebaf328739bd10c2ec26424a9330244dcd8b807f2b479c1ec3682345a26387f (confere com a última aprovação)

## Decisões da Sombra

- loop:2 · REQ-VEL-1 · DS9 APROVADA: manter os testes históricos (conversa-pontos, avaliar-*) na suíte de toda task. Tirá-los ganha ~1 s cada depois da divisão e perde 221 e 64 testes, o que contraria o objetivo da D-G35 ("qualidade de forma segura"). Nenhum dele… · fontes: docs/superpowers/specs/2026-11-22-gm19-velocidade-testes-design.md:11, docs/superpowers/specs/2026-11-22-gm19-velocidade-testes-design.md:36-37, docs/superpowers/specs/2026-11-22-gm19-velocidade-testes-design.md:51, docs/superpowers/specs/2026-11-22-gm19-velocidade-testes-design.md:59-61, docs/superpowers/specs/2026-11-22-gm19-velocidade-testes-design.md:163-166, docs/superpowers/specs/2026-11-22-gm19-velocidade-testes-design.md:176-178, docs/superpowers/specs/2026-11-22-gm19-velocidade-testes-design.md:188, docs/superpowers/specs/2026-11-22-gm19-velocidade-testes-design.md:197, docs/superpowers/specs/2026-11-22-gm19-decisoes-dono.md:5-8, docs/aprendizados/processo-orquestrador.md:59

## Emendas

- nenhum

## Liberações de teto

- nenhum

## Desvios

- nenhum

## Descobertas

- loop:9 · tecnica · GM-19 T1 REQ-VEL-1 medido no sha cfd5b7b7: 271,2 / 263,0 / 263,8 s (mediana 263,8; base ~490), load1 antes 7,11 / 6,34 / 7,58; prova A rc 0 nas 3 (5783 testes, só o S6 vermelho, igual à base). Decisão pela regra da spec: integra, meta de 30…
- loop:10 · tecnica · s6-gabarito-zero-errado: separatrue vermelho na base bfa322ad/8c6a8f40 em 3 de 3 execuções de 2026-11-22 e 3 de 3 de 2026-11-23 (prova A igual à base), fora da task; integrar da GM-19 com S6_REPOS_DIR vazio (processo, Golden S6; backlog l.7…

## Aprendizados D

- loop:17 · E · Regra que reconhece por padrão (caminho, cabeçalho): o teste tem 1 caso de cada família que pode aparecer (a permitida, a do mod, outra pasta, sem cabeçalho), não só as nomeadas; mutação que estreita a regra a uma família tem de morrer · entra em: instantaneo, brief:implementador · sem medição · eventos: loop:16 · gatilho: loop:16
- loop:29 · E · Medição ou teste fora do gate roda com TMPDIR fora do repositório (getconf DARWIN_USER_TEMP_DIR) e confere a lista de diários antes e depois; TMPDIR dentro do repo deu 903 falhas falsas e gravou fixtures no diário real · entra em: instantaneo, brief:implementador · fonte: docs/aprendizados/processo-orquestrador.md · número: 903 · gatilho: loop:27

## Aprendizados M

- nenhum
