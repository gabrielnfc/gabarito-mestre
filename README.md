# Gabarito Mestre

[![ci](https://github.com/gabrielnfc/gabarito-mestre/actions/workflows/ci.yml/badge.svg)](https://github.com/gabrielnfc/gabarito-mestre/actions/workflows/ci.yml) [![release](https://img.shields.io/github/v/release/gabrielnfc/gabarito-mestre?label=release)](https://github.com/gabrielnfc/gabarito-mestre/releases) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Gabarito mestre** é o molde de referência da manufatura — aquele contra o qual todos os outros são conferidos. É o que este plugin de Claude Code faz: **barra o que é destrutivo** (hooks) e **confere o que é produzido** (skills de conformidade, review adversarial e spike), enquanto o **doctor** mede — e reprova quando mente — o nível real de adoção do harness.

Derivado de prática medida, não de boa-prática genérica: cada regra e cada gate existe por causa de um incidente real, e o incidente está escrito ao lado da regra (`plugins/gabarito-mestre/reference/AGENTS.md`).

Todos os números deste README foram **medidos em 2026-09-05** (Claude Code 2.1.261, Node 24.14.1, macOS). Onde não foi possível medir, está escrito **NÃO MEDIDO**.

---

## Instalação

```
/plugin marketplace add gabrielnfc/gabarito-mestre
/plugin install gabarito-mestre@gabarito-mestre
```

Ou pela linha de comando:

```bash
claude plugin marketplace add gabrielnfc/gabarito-mestre
claude plugin install gabarito-mestre@gabarito-mestre
```

**Repo privado funciona** desde que `git clone` funcione com as credenciais locais (o marketplace é clonado via git). **Node ≥ 22.18** para os gates (type stripping ligado por padrão; abaixo disso, `--experimental-strip-types` ou copie os dois `.ts` para o seu `src/`).

**Atualização só chega quando o campo `version` de `plugin.json` muda.** Editar o conteúdo sem subir a versão não atualiza ninguém. Auto-update está desligado por padrão em marketplaces não-Anthropic: `claude plugin update gabarito-mestre` ou ligue em `/plugin`.

### Plugins vizinhos — o que instalar à mão

| Plugin | Papel | Instala sozinho? (M11, medido) |
|---|---|---|
| **superpowers** `superpowers@claude-plugins-official` | **sempre** — CONDUZ o processo (brainstorm, plano, TDD, subagentes) | **Sim, se** o marketplace `claude-plugins-official` já estiver registrado: `✔ Successfully installed plugin: gabarito-mestre@gabarito-mestre (scope: user) (+ 1 dependency: superpowers)`. **Não, se** não estiver: o plugin instala mas **falha ao carregar**, com erro explícito (não silencioso): `Dependency "superpowers@claude-plugins-official" is not installed — run claude plugin install superpowers@claude-plugins-official, or check that its marketplace is added`. Conserto: `claude plugin marketplace add anthropics/claude-plugins-official` e reinstale. |
| **ui-ux-pro-max** | **condicional** — DESENHA quando a tarefa é de UI/UX | **Não declarado como dependência.** Na máquina de origem ele existe como skill avulsa em `~/.claude/skills/ui-ux-pro-max/` (44 KB de SKILL.md), **não** como plugin de nenhum marketplace registrado, e não foi possível confirmar um identificador `plugin@marketplace`. Instale por conta própria; as skills do gabarito degradam com aviso se ele faltar. |

Divisão de trabalho (escrita em `reference/AGENTS.md §9` e no corpo de cada skill):

```
superpowers      CONDUZ   como o trabalho é dividido, despachado e executado
ui ux pro max    DESENHA  layout, interação, acessibilidade, texto de interface
gabarito-mestre  MANDA    o que não se negocia, e o formato do que sai
```

Em conflito, **o gabarito vence** (item 1 da ordem de autoridade). As skills do gabarito **não refazem** o que superpowers faz: delegam, conferem, emendam. Plugin vizinho ausente **não** pula a etapa — a skill degrada para o modo próprio e avisa em uma linha (G9).

**Composição medida (M12):** numa sessão headless com os dois plugins ativos, pedido de plano de implementação → `superpowers:brainstorming` → `superpowers:writing-plans` conduziram; `gabarito-conformidade` conferiu depois (6 faltas na 1ª passada: STATUS, alternativa rejeitada em D1/D3/D4/D6, mutação nomeada em REQ-2/REQ-4, emenda datada, ponteiros arquivo:linha), emendou, reconferiu CONFORME. Sem duplicação de régua. O hook R2 barrou um `rm -rf` de diretório temporário no meio da conferência e a sessão respeitou.

---

## O que vem no pacote

```
plugins/gabarito-mestre/
  skills/    gabarito-instalar · gabarito-conformidade · gabarito-review · gabarito-spike
  agents/    gabarito-implementador · gabarito-revisor · gabarito-spike
  commands/  /gabarito-doctor
  hooks/     guard-destructive.sh (R2) · guard-production.sh (R3)
  reference/ AGENTS.md + referencia.md · gates.md · adocao.md · prompts.md
  gates/     7 gates, 77 testes, zero dependências
  templates/ harness.config.json · attest.json · CLAUDE.md · gabarito.yml (CI)
  scripts/   instalar.sh
```

Depois de instalar o plugin, **instale o harness no seu repositório**: diga "instala o gabarito" (skill `gabarito-instalar`) ou rode `bash <plugin-root>/scripts/instalar.sh .`. Ele cria `AGENTS.md`, `CLAUDE.md` (só a linha `@AGENTS.md`), `docs/harness/`, `tools/gabarito-gates/`, `harness.config.json`, `.harness/attest.json` e `.github/workflows/gabarito.yml`; nunca sobrescreve nem apaga; e roda o doctor ao fim. **O nível de adoção fica `____`** — é o doctor quem mede (`/gabarito-doctor`).

---

## Hooks — o que bloqueiam, e os números

Dois `PreToolUse` sobre `Bash`. Leem o comando, inspecionam por grep (não parser — I9), bloqueiam com `exit 2` e devolvem o motivo em três camadas (frase → o que fazer → regra citada). Confirmado em sessão real: `rm -rf junk` e `curl "$API_PROD_URL/health"` bloqueados, com o motivo chegando verbatim ao agente e o alvo intacto.

### `guard-destructive.sh` — R2

| Família | Exemplos barrados |
|---|---|
| rm recursivo | `rm -rf` · `rm -r` · `\rm -rf` · `--recursive` · `rimraf` · `find … -delete` · `find … -exec rm` · dentro de `{ }`, `then`, `do`, `sudo`, `xargs`, `nohup`, `timeout N` |
| git destrutivo | `git clean -f\|-fdx` · `git reset --hard` · `git worktree remove --force` · `git rm -r` (sem `--cached`) — dry-run `-n` e `--soft` passam |
| docker | `docker rm -f\|-v` · `docker volume rm\|prune` · `docker system prune` · `docker compose down -v` |
| reset de migrations | `prisma migrate reset` · `db push --force-reset` · `typeorm schema:drop` · `sequelize db:drop` · `knex migrate:rollback --all` · `drizzle-kit drop` · `supabase db reset` · `rails db:drop\|reset` · `artisan migrate:fresh\|reset` · `manage.py flush` · `mix ecto.drop` · `dotnet ef database drop` · `flyway clean` · `liquibase drop-all` |
| payload destrutivo em executor | `DROP TABLE\|DATABASE\|SCHEMA` · `TRUNCATE` · `DELETE FROM` · `.deleteMany(` · `.updateMany(` · `fs.rmSync(…recursive)` · `shutil.rmtree` — **só quando o comando também invoca um executor** (`psql`, `mysql`, `node -e`, `python3 -c`, `prisma db execute`, `bash -c`, `eval`, `sh <<<`…). `grep "DROP TABLE"` é leitura e passa. |
| sync / nuvem / disco | `rsync --delete` · `aws s3 rm --recursive` · `gsutil rm -r` · `dd of=/dev/…` · `> /dev/sd…` · `mkfs` · `diskutil erase…` · `shred` · `wipefs` |

**Menção ≠ execução.** Antes de varrer, o hook remove (i) o corpo de heredocs que só escrevem arquivo com terminador **citado** (`cat >> notas.md <<'EOF'`) — com terminador sem aspas o bash expande `$(…)` na escrita, então essas linhas ficam; e (ii) segmentos de `grep`/`rg`/`sed`/`echo`/`git log`/`git commit -m`, que só leem ou registram texto. O que vem depois de `|`, `;` ou `&&` continua varrido (`grep x | xargs rm -rf` bloqueia).

### `guard-production.sh` — R3

Barra **uso** de credencial/host de produção: `$X_PROD_URL`, `${PROD_TOKEN}`, `process.env.API_PROD_KEY`, atribuição com valor (`API_PROD_TOKEN=abc npm test`), hosts (`prod.exemplo.com`, `api.production.exemplo.com`, `db-prod.rds.amazonaws.com`, `prod.internal`), URLs com segmento `prod`. **Não** barra: `API_PROD_TOKEN=` vazio (`.env.example`), `deploy-production.yml` (arquivo, não host), `NODE_ENV=production`, `npm install --production`, `/products`, nem menção em `grep`/`sed`/`git commit -m`/heredoc de anotação.

Configurável por env, porque domínio hardcoded de um projeto não serve para mais ninguém:

```bash
GABARITO_PROD_PATTERNS='minha-ere|outra'          # SUBSTITUI o default (ERE, case-insensitive)
GABARITO_PROD_PATTERNS_EXTRA='sankhyacloud\.com\.br' # SOMA ao default
```

### Taxas medidas

| Medição | Resultado |
|---|---|
| **Falso positivo (M3)** — 50 comandos legítimos, 25 reais (transcripts de Claude Code desta máquina) + 25 sintéticos armadilha | **0 / 50 bloqueados** |
| **Falso negativo (M4)** — 30 destrutivos cobrindo as 6 famílias + 12 de produção | **30 / 30** e **12 / 12 bloqueados** |
| **Escape hatch (M5)** — motivo preenchido libera · vazio não · aviso traz o motivo · ausente não | **4 / 4 nos dois hooks** |
| **Corpus completo — 7.037 comandos Bash reais** (todos os transcripts de Claude Code desta máquina, 11 projetos; hooks da 1.0.1) | destrutivo: **46 bloqueados (0,65 %)** — 43 eram de fato `rm -rf`, `DELETE`/`DROP`, `git worktree remove --force`, `git reset --hard`, `docker rm -v` executados; **3 falsos positivos (0,04 %)**: corpo de PR (`gh pr create --body`) citando `prisma migrate reset`, heredoc de `python3` escrevendo texto com `rm -rf`, e `psql \d … \| grep` num comando que também tinha `DELETE`. Produção: **23 bloqueados (0,33 %)**, 22 acessos reais a host/credencial de produção e **1 falso positivo** (anotação de memória citando a URL). |

O rigor tem motivo: um bloqueio indevido faz alguém desativar o plugin inteiro — e aí se perde também a proteção que funcionava.

### Limites declarados (G9 — o que os hooks NÃO pegam)

É grep, não sandbox (I9). Passam, por decisão: `kubectl delete` · `terraform destroy` · `gh repo delete` · `git push --force` · `git branch -D` · `git checkout -- .` · `truncate -s0` · `: > arquivo` · `heroku -a app-prod` · `kubectl -n production` · `s3://app-prod-bucket` · `vercel --prod` · `$(cat prod-token.txt)` · e **script escrito por heredoc/Write e executado no comando seguinte** (`cat > x.sh <<'EOF' … EOF; bash x.sh`). Para o seu caso, some padrões em `GABARITO_PROD_PATTERNS_EXTRA`; para o resto existem as guardas de runtime (G3/G7) e o review adversarial com mutação.

### Escape hatch

Nominal e grepável. Regras, todas medidas:

- motivo **obrigatório**, com **≥ 8 caracteres e ≥ 2 palavras** — `"lol"` não libera; vazio ou só espaços não libera;
- vale no ambiente do processo (`GABARITO_ALLOW_DESTRUCTIVE` para R2, `GABARITO_ALLOW_PRODUCTION` para R3 — cada uma aceita a outra) ou como prefixo **no início do comando**. Comentário no fim (`rm -rf x # GABARITO_ALLOW_…`) ou `echo` no meio **não** liberam;
- o hook permite **e** imprime aviso (`systemMessage` + stderr) com o motivo e a origem (`env`/`inline`).

```bash
GABARITO_ALLOW_DESTRUCTIVE="autorizado por gabriel em 2026-09-05 — expurgo do build antigo" rm -rf build
```

A mensagem de bloqueio diz ao agente como usar o hatch **depois de obter autorização do usuário**. Isso é decisão de desenho: o motivo fica no transcript ao lado do ato, e é o que o review adversarial confere (R18). Quem preferir que só o humano libere, exporte a variável no `env` do `settings.json` e trate qualquer uso inline como achado de review.

**Fail-open declarado (G9):** sem `node`, `jq` nem `python3` para ler o JSON do stdin, o hook avisa em stderr e deixa passar — bloquear todo Bash faria o usuário desinstalar o plugin. Node é requisito do pacote de qualquer forma.

---

## Peso morto por tipo de projeto (M9, medido)

Instalado em dois repositórios descartáveis:

**(a) com ORM (Prisma), migrations e fronteira externa** — 5 das 7 checagens de nível 1 passam de imediato ao ligar `massMutationGuard()` + `assertNotProduction()` + teardown por id + `.env` ignorado; faltam só os dois atestados. Tudo se aplica.

**(b) CLI puro — sem banco, sem rede, sem tenant:**

| O que | Inaplicável | Lista |
|---|---|---|
| Checagens do doctor (19, 1 opcional) | **8 / 19** | G3 mutação em massa · G3 undefined estrito · R3 trava de produção · backup verificado · G8 migrations · ordem de subida · health commit+versão · RLS (opcional) |
| Regras do `AGENTS.md` (R1–R18) | **6 / 18** | R6 cliente único · R7 fronteira não mockada · R8 idempotência · R10 tenant · R11 erro cru de terceiro · R12 escrita em ambiente compartilhado |
| Guardas (G1–G9) | **8 / 9** | G1–G8 (só G9 fail-closed sobrevive) |
| Hooks | **1 / 2 sem uso** | `guard-production.sh` nunca dispara; `guard-destructive.sh` continua útil (rm, git clean, docker) |

**Consequência que importa:** num CLI puro, **4 das 7 checagens obrigatórias de nível 1 são inaplicáveis** (G3 ×2, R3, backup) — o repo **nunca sai do nível 0 pelo doctor**, por construção, não por falha. Declare no Apêndice o que é inaplicável em vez de fingir; o que vale sem nenhum gate — §1, §4 e a marcação (a)/(b)/(c) — vale igual num CLI. `adocao.md §5` diz quando o harness não serve.

---

## ANTES DE LIGAR OS GATES: MEÇA

Os parâmetros que vêm no pacote foram **calibrados em OUTRO projeto**. Copiar sem medir é herdar a calibragem de outra pessoa:

| Parâmetro | Valor de partida | Onde |
|---|---|---|
| Massa suspeita (G4) | ≥20 % **e** ≥5 registros | `referencia.md §5` |
| Corte temporal da guarda de migrations (G8) | data em que a guarda entrou — sem ele, a primeira PR trava para sempre nas migrations antigas | `migrations-guard.mjs` (constante pinada por teste) |
| Tolerância do ratchet | 0,5 pp | `quality-ratchet.mjs` |
| Teto de duplicação | medição atual + folga pequena | `harness.config.json` |
| Padrão destrutivo de migration | `DROP\|TRUNCATE\|UPDATE\|DELETE`, isentando ação referencial de FK (sem isso: 11 de 36 falsos positivos no projeto de origem) | `migrations-guard.mjs` |

**Como calibrar cada um: `docs/harness/adocao.md §3`.** Toda calibragem entra no Apêndice do `AGENTS.md` com a data da medição. Parâmetro sem data é parâmetro herdado.

---

## Verificação do próprio pacote

```bash
claude plugin validate ./plugins/gabarito-mestre --strict   # Validation passed
cd plugins/gabarito-mestre/gates && npm test                  # 77 testes (50 mjs + 27 ts)
node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs               # corpora dos hooks
```

**Testes dos hooks:** `node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs` roda os corpora deste README (legítimos, destrutivos, produção, escape hatch) contra os scripts reais — é o que o CI do repositório executa.

**Por que `plugin.json` não declara `hooks`:** `hooks/hooks.json` é carregado automaticamente; declarar `"hooks": "./hooks/hooks.json"` faz o plugin **falhar ao carregar** com `Duplicate hooks file detected` (medido em 2.1.261). `validate --strict` não pega isso; só `claude plugin list` depois de instalar.

O doctor **não se auto-detecta**: o pacote de gates e a pasta `reference/` são excluídos da varredura em qualquer local de instalação (M10). Antes dessa exclusão, rodar o doctor na raiz deste repositório contava 9 checagens como "ok" a partir dos próprios testes dos gates.

## Contribuir

[`CONTRIBUTING.md`](CONTRIBUTING.md) — o que aceitamos e o checklist de PR · [`SECURITY.md`](SECURITY.md) — bypass de hook é vulnerabilidade · [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) · [`CHANGELOG.md`](CHANGELOG.md).

O achado mais valioso é um **comando legítimo bloqueado**: abra a issue "Hook: falso positivo / negativo" com o comando exato.

## Licença

[MIT](LICENSE).
