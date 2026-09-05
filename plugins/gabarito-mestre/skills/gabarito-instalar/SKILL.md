---
name: gabarito-instalar
description: Instala o harness Gabarito Mestre neste repositório. Use quando o usuário pedir para "instalar o gabarito", "instalar o harness", "adotar o gabarito-mestre", "configurar AGENTS.md", "setup do harness", "colocar os gates neste repo", "bootstrap do gabarito" ou "install gabarito". Cria AGENTS.md, CLAUDE.md (só o import), docs/harness/, tools/gabarito-gates/, harness.config.json, .harness/attest.json e o workflow de CI, e roda o doctor ao fim. Nunca declara o nível de adoção.
allowed-tools: Bash(bash:*), Bash(node:*), Bash(ls:*), Bash(cat:*), Read, Glob
---

# gabarito-instalar

Instala o harness no repositório do usuário. **Instalar não é adotar**: ao fim, o nível de adoção fica `____` e é o doctor quem mede.

## Divisão de trabalho (ver `${CLAUDE_PLUGIN_ROOT}/reference/AGENTS.md §9`)

- **superpowers CONDUZ** — se o usuário quiser, depois da instalação, planejar a subida de nível, é `superpowers:brainstorming` → `superpowers:writing-plans` que conduz. Esta skill não planeja.
- **ui-ux-pro-max DESENHA** — não participa da instalação.
- **gabarito-mestre MANDA** — o que entra no repo, e o fato de que o nível não é declarado por ninguém além do doctor.

**Fail-closed declarado (G9):** superpowers ausente não impede a instalação (ela é determinística). Avise em uma linha: `superpowers não está instalado — a instalação segue; o planejamento da subida de nível ficará sem a maquinaria de brainstorm/plano.`

## Passos

1. Confirme o diretório alvo (raiz do repositório, onde fica o `.git`). Não instale em subpasta sem o usuário pedir.

2. Rode o instalador — ele **nunca sobrescreve nem apaga**; arquivo existente é mantido e reportado:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/instalar.sh" .
```

   O que ele cria (a partir de `${CLAUDE_PLUGIN_ROOT}/reference/` e `templates/`):

   | Destino | Origem | Observação |
   |---|---|---|
   | `AGENTS.md` | `reference/AGENTS.md` | núcleo, lido sempre; Apêndice em branco |
   | `CLAUDE.md` | `templates/CLAUDE.md` | **APENAS** a linha `@AGENTS.md`. Os docs de referência **não** são importados — são sob demanda, de propósito |
   | `docs/harness/{referencia,gates,adocao,prompts}.md` | `reference/` | consultados por ponteiro |
   | `tools/gabarito-gates/` | `gates/` | 7 gates + 77 testes, zero dependências, Node ≥ 22.18 |
   | `harness.config.json` | `templates/` | template — ajustar e apagar o que não usar |
   | `.harness/attest.json` | `templates/` | tudo `confirmado: false` — atestar é ato nominal e datado |
   | `.github/workflows/gabarito.yml` | `templates/` | doctor + testes dos gates + guarda de migrations |

3. Cole a saída do instalador e a do doctor (ele roda ao fim). **Não interprete o nível como "pretendido"**: o número que vale é o `Nível alcançado`.

4. Diga ao usuário, nesta ordem:
   - preencher o **Apêndice** do `AGENTS.md` (stack, fronteiras, tenant, comandos) — sem ele o documento é teoria;
   - declarar no `§0.2` **o nível que o doctor mediu** (num repo novo: `0`). Rodar `/gabarito-doctor` sempre que quiser conferir;
   - **antes de ligar qualquer gate, calibrar** (`docs/harness/adocao.md §3`): os parâmetros do pacote vieram de outro projeto;
   - se o projeto **não tem** ORM, migrations ou fronteira externa, parte do harness é peso morto — o README do plugin diz quanto; marque no Apêndice o que é inaplicável (R7, G7, G8) em vez de fingir.

## Proibido

- Declarar nível de adoção. A skill deixa `____`. Nível é medido, nunca presumido.
- Importar `docs/harness/*.md` no `CLAUDE.md`.
- Sobrescrever ou apagar qualquer arquivo do usuário (R2). O instalador não faz isso; você também não.
- Commitar (R1). Mostre o `git status` e pare.
