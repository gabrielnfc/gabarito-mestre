# Política de segurança

Os hooks deste plugin são um **controle de segurança**: barram comandos destrutivos (R2) e acesso a produção (R3)
antes de executarem. Um bypass é vulnerabilidade, não "edge case".

## Reportar

- **Bypass de hook** (comando destrutivo ou de produção que passa) ou **falso positivo** que leve alguém a desligar
  o plugin: abra um *security advisory* privado em GitHub → Security → "Report a vulnerability", ou a issue
  "Hook: falso positivo / negativo" se o comando não for sensível.
- Inclua: o comando exato (anonimizado), versão do plugin, versão do Claude Code, SO/bash (`bash --version`).
- Resposta em até 7 dias; correção com caso de teste no corpus e nova versão.

## O que NÃO é vulnerabilidade (limites declarados)

Está escrito no README, seção "Limites declarados": os hooks são grep, não sandbox. `kubectl delete`,
`terraform destroy`, `git push --force` e script escrito por heredoc e executado depois **passam por decisão**.
Se você acha que um desses deveria entrar no default, abra uma issue de feature com o incidente que motiva.

## Versões suportadas

Só a última versão publicada no marketplace recebe correção.
