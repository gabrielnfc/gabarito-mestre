<!--
Título desta PR: `tipo(PBI-n): assunto` — é o cabeçalho do commit de squash que entra em main (R20).
tipo ∈ feat | fix | enabler | debt | spike | task | perf | refactor (com PBI) · chore | docs | ci | build | test | release | revert (sem PBI).
-->

## Fio condutor (R19)

- **PBI:** `<ID>` — <título do card>
- **Epic:** `<ID>` · **Iniciativa:** `<ID>` (ou "padrão do repo")
- **Tipo:** US · Enabler · TechDebt · Spike · Bug · Tarefa
- **Requisito(s) que fecha:** `REQ-…` (`<spec>:<linhas>`)
- **Plano:** `docs/plans/<…>.md` · **Ledger:** `docs/ledgers/<PBI>.md`

## Banco e deploy

- **Migration:** nenhuma · aditiva · **destrutiva** — plano de volta em `<caminho>` (SQL executável ou irreversibilidade declarada com procedimento)
- **Compatível com a versão no ar (expand/contract)?** sim · não — por quê:
- **Ordem de subida:** n/a · consumidor → produtor: <quem antes de quem>
- **Janela de deploy:** nenhuma · <o que degrada, por quanto tempo, por que foi aceita>

## Prova

- [ ] Teste visto **vermelho** antes da implementação (R13) — o ledger registra RED→GREEN com contagem
- [ ] Review adversarial **APROVADO** com mutações executadas — o ledger registra o que o revisor provou
- [ ] Escrita em ambiente compartilhado marcada e desfeita por id; teardown conferido (R12)
- [ ] `CHANGELOG.md` — linha em `[Unreleased]`, categoria certa, citando o PBI (R20)
- [ ] Nada fora do escopo do PBI; o que sobrou está em `docs/backlog.md` com dono e gatilho (R17)
- [ ] Toca escrita em sistema externo, RBAC ou segurança? sim (PR própria, `referencia.md §3.4`) · não

## Revisão humana

- **Revisor humano (dono da área — `.github/CODEOWNERS`):** @<quem>
- Áreas tocadas fora da minha: <nenhuma | área — revisor @quem>
