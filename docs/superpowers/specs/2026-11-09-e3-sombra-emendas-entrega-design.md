# E3 — Sombra + emendas + política de entrega

Iniciativa: gabarito-mestre 2.0 · Epic: E3 · PBI: GM-11 (Enabler) · Data: 2026-11-09 · Visão: `2026-10-31-visao-2.0-design.md` §6.2, §6.3, §6.5, §6.6, §6.9 · r2 (r1 + 6 dúvidas do plano decididas pela Sombra, `sombra-plano.md`; r1 = r0 + 15 MAJOR e 9 MINOR decididos pela Sombra, `.superpowers/sdd/2026-11-09-e3-sombra/sombra-spec.md`, delegação do dono de 2026-11-04)
Legenda: **(a)** medido/lido · **(b)** a medir · **(c)** decisão do dono, da Sombra ou do redator.

**STATUS.** Hoje (E2 em `next`, e247de6): loop, pouso, guarda, diário com cadeia de hash e canário. A Sombra existe só como prática do orquestrador (arquivos `sombra-*.md`); o diário não conhece `decisao.sombra`, `desvio`, `emenda.*` nem entrega. **Esta spec: nada implementado.**

**Objetivo.** Dúvida do loop vai à Sombra por um caminho fixo e nunca é perguntada duas vezes; descoberta e spec errada viram evento com evidência, congelando só o REQ afetado; a entrega para produção segue a política declarada, sem perguntar no momento do deploy.

## Fatos (a)

| # | Fato |
|---|---|
| F1 | E2: 26 consultas à Sombra (52 arquivos `sombra-*` em `.superpowers/sdd/2026-11-03-e2-loop/`, brief + resposta); E1: 10. Sombra somou 112 de 1.065 min de agente até T13 (`processo-orquestrador.md`) |
| F2 | `diario.ts:append` só recusa canário e linha > 16.384 (`diario.ts:36,146`); não valida `dados` por tipo; lock por sessão (`diario.ts:149`). `TipoEvento` fechado em `tipos.ts:9-27` |
| F3 | `decidir.ts:66`: segmento `prod` só vai a `mostrar` se casar `permitidos`, só para o orquestrador. Config da guarda vem de `origin/HEAD` (`guarda.ts:107-117`) |
| F4 | `loop.ts:proximaAcao` não conhece REQ; `Plano.entrega` é o id da entrega (`tipos.ts:90`); `esperar` é silêncio no Stop (`stop-loop.mjs:13,88`) |
| F5 | `uso-subagent.mjs:163` deduplica `custo.medicao` por `agente = 'subagent:<id>'`; sem modelo. `message.model` aparece no transcript do subagent (N=1, 44/44 linhas) |

## Decisões (c)

- **D1 Decisão é evento do diário, não arquivo à parte.** `decisoes` = projeção dos `decisao.sombra` válidos; `append` valida só a forma por tipo, o CLI valida o que depende de estado (como `gravar` faz com transições) e a projeção ignora o inválido. Rejeitado: `decisoes.jsonl` separado, sem cadeia.
- **D2 Teto de consultas = 26 por entrega, Atenção.** Maior medido (F1), sem margem; revisto pela contagem de `sombra.consulta` da 1ª entrega que o passar. Rejeitado: Parar no teto, babá (visão §6.6).
- **D3 Sombra em Opus 5.5** (visão §6.6 e §6.9, dono 2026-11-09). Implementador default Sonnet 5.5 `high` (GM-10 R9).
- **D4 Entrega roda comandos declarados, nunca adivinha plataforma.** GitHub Environments, flags e promoção de digest são enablers da E5.

## Requisitos

**REQ-SOM-1 Consulta por caminho fixo.** `sombra.mjs perguntar (--req <REQ> | --task <id>) --pergunta <texto>`. Hash = sha256 dos campos unidos por `\n`: âncora (`<REQ>` ou `task:<id>`), `versao` (`proposta_seq` da última `spec.emendada` do REQ, ou `0`) e pergunta normalizada (caixa, espaço). Decisão válida ⇒ resposta e `cache: true`. Ausente ⇒ grava `sombra.consulta {pergunta_hash, req|task}`, depois o brief `<entrega>/sombra/<hash>.md` só com pergunta, âncora, caminho da spec, trecho do REQ (ou da task no plano) e as emendas aprovadas dele, mais a instrução de ignorar resposta embutida; nunca transcript, diff nem hipótese. Consulta aberta sem decisão ⇒ `pendente: true`, sem brief novo. `perguntar` devolve o `prompt` exato do despacho do agente `agents/gabarito-sombra.md` (só leitura). REQ fora da spec, task fora do plano ou `plano.spec` ausente ⇒ recusa com motivo.

**REQ-SOM-2 Decisão com fonte.** `sombra.mjs registrar <hash> <resposta.json>` grava `decisao.sombra {pergunta_hash, req|task, resposta ≤ 1.000 caracteres, arquivo, fontes[] | medicao, pergunta_enviesada, substitui?: {sessao, seq}}`; texto inteiro em `<entrega>/sombra/<hash>.resposta.md`. Recusa sem `fontes[]` não vazio nem `medicao`, resumo longo antes do diário e `substitui` inexistente. `fora_da_regra: true` dispensa fontes e exige `emenda_seq` de `emenda.proposta` já gravada no mesmo REQ. Nunca apaga; sem `substitui`, vence a mais recente por `(ts, sessao)`.

**REQ-SOM-3 Decisão chega a quem decide.** Instantâneo do pouso traz as decisões, no máximo 1.600 dos 3.200 caracteres, resposta cortada em 160 por linha, com contagem do que ficou fora. Itens `implementador`, `correcao` e `revisor` de `proxima` levam as decisões dos REQs da task.

**REQ-SOM-4 Teto e custo.** `sombra.teto` (default 26, D2). Consulta = `sombra.consulta`; acerto de cache não conta. Acima do teto, `perguntar` segue e `proxima` traz `aviso` de Atenção. Custo: `custo.medicao` como qualquer subagent (`agente: 'subagent:<id>'`) com `papel: 'sombra'` vindo do `agent_type`. Com mod ativo, se o `turn.complete` não expõe o tipo do agente, o mod grava primeiro e `papel` falta (dedupe por `agente`): limite declarado; custo por consulta medido com o mod desligado. Guarda nega `Agent` de Sombra cujo `prompt` difere do devolvido para hash com consulta aberta.

**REQ-EME-1 Desvio e emenda como evento.** `desvio {task, req, evidencia, arquivos[], causa}`, `descoberta {evidencia, causa}`, `emenda.proposta {req, task?, diff, fato, alternativa, evidencia, causa, arquivos?[]}`, `spec.emendada {proposta_seq, origem}`, `emenda.rejeitada {proposta_seq, origem}`, com `causa: regra_negocio | tecnica`. Diário recusa sem campos ou com `evidencia` vazia; CLI recusa julgamento sem proposta aberta. `origem:'dono'` só por `/<plugin>:emenda aprovar|rejeitar <seq>`, gravado por hook `UserPromptExpansion` como `liberar` (mesmo limite Q14). `origem:'sombra'` só com `sombra.julga_emendas: true` lido de `origin/HEAD` (default `false`). Dúvida desvio × descoberta ⇒ `perguntar`. `emenda.proposta` só vale gravada na sessão `emendas` do diário da entrega (`loop.mjs emenda propor` ignora `--sessao`); `proposta_seq` e `emenda_seq` são o `seq` dela nessa sessão, único pelo lock do arquivo. Proposta em outra sessão é ignorada pela projeção. Julgamento pode vir de qualquer sessão; o 1º válido na ordem de `ordenar` fecha a proposta.

**REQ-EME-2 Congela só o REQ.** `TaskPlano.reqs[]` (ausente = não congela). Proposta aberta no REQ ⇒ `proximaAcao` não despacha (implementador, correção, revisor) nem integra task com ele, nem dependente; task em voo termina e o revisor recebe a proposta. Tudo congelado e nada em voo ⇒ `esperar{emenda}`: o Stop não bloqueia e emite `systemMessage` com propostas (`seq`, REQ) e o comando; `spec.emendada` e `emenda.rejeitada` entram em `TIPOS_DE_PROGRESSO`. `spec.emendada` em REQ de task `integrada` ⇒ `aviso` com a task. Gate soma ao escopo da task os `arquivos[]` das propostas aprovadas com `task` igual; proposta cujos arquivos coincidam com task sem dependência é recusada (REQ-LOOP-1).

**REQ-EME-3 Revisor contra a spec emendada.** Item `revisor` traz as emendas aprovadas dos REQs da task (`proposta_seq`, `diff`); `gate-task` relata desvios; `loop.mjs integrar` devolve as linhas `desvio:`/`aviso:` em `relato` também no verde (emenda da Sombra, `sombra-relato-verde.md`, 2026-11-09). Revisor que aprova sem citar a emenda: limite declarado, mitigado pelo item visível.

**REQ-ENT-1 Política como dado.** `entrega.politica` (`continua | janela | sob_demanda`, default `sob_demanda`) e `entrega.comandos` lidos de `origin/HEAD`; sem origin, `sob_demanda` sem comandos. `plano.politica_entrega {politica?, exige_prod, janela?}` só aperta (`continua` → `janela` → `sob_demanda`), afrouxar é recusado. `janela = {dias[0-6], inicio, fim 'HH:MM', fuso IANA}`. `ci_homolog` = último `ci.resultado {verde, alvo:'homolog'}` posterior à última `task.integrada` (deploy em homolog é do CI do usuário, limite declarado). `decidirEntrega` puro: `continua` e `janela` só sobem com `ci_homolog` verde. Sem `ci_homolog` ⇒ `esperar{homolog}` (Informar); último vermelho ⇒ `esperar{homolog}` com `aviso` (Atenção); 2 vermelhos seguidos depois da última integração ⇒ `parar{ci_vermelho}`. Com ele, `continua` ⇒ `subir`; `janela` dentro ⇒ `subir`, fora ⇒ `agendar{quando}` (grava `entrega.agendada` se o `quando` for novo, Informar). Sessão em ou após `quando` decide de novo: janela aberta ⇒ `subir`, fechada ⇒ novo `agendar`; nunca sobe fora da janela; `sob_demanda` ⇒ `release_pr` (PR para `entrega.base`, default `main`, nunca merge). `exige_prod` com `sob_demanda` ⇒ `parar{janela_ausente}` antes do 1º despacho.

**REQ-ENT-2 Execução e rollback.** `entrega.mjs` roda `entrega.comandos.{deploy, smoke, rollback}` (argv, sem shell, `timeout_s` default 600, estouro = falha), grava `entrega.inicio`, `entrega.smoke {ok}`, `entrega.rollback`, `entrega.fim` e `producao.acesso {acao:'escrita'}` em deploy e rollback. Smoke falho ⇒ rollback e `parar{smoke}`; rollback falho ⇒ `parar{rollback}`. Deploy falho ⇒ rollback (com `producao.acesso`) e `parar{nao_conseguiu}` (`entrega.fim {motivo:'deploy'}`); rollback falho ⇒ `parar{rollback}`. Comando só no stdout e em `systemMessage`, nunca no diário. `continua` sem comandos ⇒ `release_pr` com `aviso`. Guarda nega a subagent todo Bash que contém `entrega.mjs` (substring, sem caixa, qualquer posição).

**REQ-MOD-1 Modelo por papel.** `orquestracao.modelos.{implementador, revisor, sombra, revisor_final, spike, basico}`, defaults da visão §6.9 e D3; `orquestracao.modelo` existente segue para o orquestrador. `proxima` põe `modelo` em cada item; `custo.medicao` ganha `modelo` de `message.model` do transcript, `null` se ausente. Doctor avisa papel abaixo do recomendado; não compara modelos entre papéis (trava é instância nova por item, por construção do despacho). Não bloqueia.

## Spikes e medições (b)

Nenhuma premissa externa nova. A medir na entrega: `modelo` pelo mod (`turn.complete`); consultas evitadas por cache e custo por consulta, contados na mesma entrega.

## Fora de escopo (dono: Gabriel)

Deploy real em produção (só com ordem do dono) · GitHub Environments, flags, digest (E5) · glossário do pacote do Horizon (E5) · painel e faixa amarela (E4; aqui só `aviso`) · limiar de ~20 % do esforço (visão §6.3): sem estimativa por task até E5, só o critério de arquivos · `git -C` em Q16, `rtk`/`exec`/`xargs` antes de `git`, `cat .en?` (antes de `main`, ledger GM-10; Sombra: não são dependência).

## Testes e aceites

Núcleo puro por `node --test`, mutação nomeada por REQ. **Fumaça sem LLM** em `npm test`: plano de 3 tasks com `reqs`, consulta, cache, consulta pendente, emenda que congela 1 task e libera após `spec.emendada`, entrega em repo descartável com comandos de script (deploy ok, smoke falha, rollback). **Aceite 1:** em TUI `auto`, haiku, a mesma pergunta 2× gera 1 agente Sombra e 1 `decisao.sombra`; a 2ª volta `cache: true`. **Aceite 2:** emenda aberta no REQ de T1: T2 independente chega a `integrada`, T1 espera com aviso no Stop; `spec.emendada` ⇒ T1 segue a `concluir`. **Aceite 3:** `continua` com smoke falho ⇒ rollback executado e `parar{smoke}`, nenhum alvo real. **Aceite 4:** com o mod desligado, `custo.medicao` do agente Sombra do aceite 1 traz `modelo` e `papel: 'sombra'`; com o mod ativo, o fechamento registra (b) quem gravou e se `papel`/`modelo` vieram. CI 100 % verde; review final Fable.
