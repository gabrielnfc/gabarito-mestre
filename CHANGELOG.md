# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versionamento: [SemVer](https://semver.org/lang/pt-BR/).
Usuários do plugin só recebem atualização quando `version` muda.

## [1.0.1] — 2026-09-05

Correções do review adversarial independente (2 Critical, 7 Important, 14 Minor).

### Corrigido
- **Hooks — bypass por heredoc sem aspas** (C1): `cat > x <<EOF` + `$(rm -rf …)` passava; agora o corpo só é
  ignorado quando o terminador é citado (`'EOF'`), e linhas com `$(`, crase ou `${` são mantidas.
- **Gates — scripts mudos em caminho com espaço ou acento** (C2): o guard de entrypoint usava `file://` cru e
  `main()` não rodava (exit 0 silencioso). Agora usa `fileURLToPath` + `resolve`.
- **Hooks — falsos negativos** (I1): `{ rm -rf; }`, `then`/`do`, `\rm`, `nohup`, `timeout N`, `bash -c`, `eval`,
  `<<<`, `fs.rmSync(…recursive)`, `shutil.rmtree`, `find -delete|-exec rm`, `rimraf`, `git rm -r`,
  `git reset --hard`, `git worktree remove --force`, `rsync --delete`, `docker rm -f`, `aws s3 rm --recursive`,
  `gsutil rm -r`.
- **Hooks — host com sufixo `-prod` fora de URL** (I2): `psql -h db-prod.example.com`, `prod.internal`.
- **Hooks — menção ≠ acesso** (I3): `grep`, `rg`, `sed`, `echo`, `git log/commit -m` e heredoc de anotação não
  bloqueiam mais; o que vem depois de `|`/`;`/`&&` continua varrido.
- **Escape hatch** (I6): só no início do comando ou no ambiente; motivo ≥ 8 caracteres e ≥ 2 palavras;
  alias `GABARITO_ALLOW_PRODUCTION` para R3.
- JSON do aviso válido com TAB/controles no motivo (M1); stdin vazio/malformado avisa em stderr (M2);
  hooks invocados via `bash "…"` para não depender do bit +x (M3); `instalar.sh` sem `|| true` mascarando o
  doctor, sem `.DS_Store`, com padrão citado (M5); contagem de testes unificada em 77 (I5).

### Alterado
- Pacote de gates renomeado para `gabarito-gates`; exemplos de import em `gates.md` usam caminho relativo (M6).
- Template de CI não liga mais a guarda de migrations por padrão — calibre antes (I7).
- `/gabarito-doctor` prefere a cópia instalada em `tools/gabarito-gates/` (M11).
- `gabarito-review`: `allowed-tools` restrito a `git checkout -- *` (M10).

### Adicionado
- Suíte de testes dos hooks (`hooks/test/guards.test.mjs`, 148 casos) com os corpora do README.
- Seção "Limites declarados" no README e no `AGENTS.md §9`.
- Arquivos de comunidade: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, templates de issue/PR, CODEOWNERS, CI.

## [1.0.0] — 2026-09-05

Primeira publicação: marketplace + plugin com hooks R2/R3, 4 skills, 3 agents, `/gabarito-doctor`, 7 gates
(77 testes), instalador, templates e README com as 13 medições.

[1.0.1]: https://github.com/gabrielnfc/gabarito-mestre/compare/gabarito-mestre--v1.0.0...gabarito-mestre--v1.0.1
[1.0.0]: https://github.com/gabrielnfc/gabarito-mestre/releases/tag/gabarito-mestre--v1.0.0
