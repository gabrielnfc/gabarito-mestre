# Virada para a 2.0

Para quem usa o Gabarito Mestre. O que mudou está no `CHANGELOG.md`, seção `[2.0.0]`; aqui, o que fazer.

## O que muda da 1.1

- O hook de segurança agora é um só (`guarda.js`), no lugar de `guard-destructive.sh` e `guard-production.sh`. Ele pede confirmação ou nega em segredo, integridade do harness e escrita em produção; comando destrutivo local vira registro, sem barrar.
- As variáveis de contorno da 1.1 não existem mais (detalhe no CHANGELOG, seção 2.0.0). Rotina de produção autorizada entra em `guarda.producao.permitidos`, no `harness.config.json`.
- O onboarding é de uma fase só, com no máximo cinco perguntas, e a organização do trabalho (Iniciativa, Epic, PBI) se chama Fluxo Gabarito.
- Há um loop de entrega (skill `gabarito-loop`), a aprovação da spec pelo dono, o aprendizado do agente, o registro de decisões e o painel no terminal.

## Como atualizar

1. `claude plugin marketplace update gabarito-mestre`
2. `claude plugin update gabarito-mestre@gabarito-mestre`, e reinicie o Claude Code. A atualização automática vem desligada para catálogo de terceiros: sem esses comandos, nada muda.
3. Só vale para quem tem o plugin instalado no usuário e também em algum projeto (escopo project). Nesse caso rode também, dentro de cada repo: `claude plugin update gabarito-mestre@gabarito-mestre --scope project`. Sem isso esse projeto continua na 1.1.0, e o `claude plugin list` pode mostrar 2.0.0 mesmo assim (medido). Para conferir, abra o arquivo `installed_plugins.json`, na pasta `plugins/` da configuração do Claude Code (normalmente `~/.claude/plugins/installed_plugins.json`; quem usa outra pasta de configuração abre o lugar equivalente), e veja `"version": "2.0.0"` em cada entrada de `gabarito-mestre`. Quem instalou só por projeto já é atualizado pelo passo 2.
4. Só quem instalou a pré-versão (o catálogo `gabarito-mestre-next`): `claude plugin uninstall gabarito-mestre@gabarito-mestre-next --scope project` e `claude plugin marketplace remove gabarito-mestre-next`. Senão ficam dois plugins com o mesmo nome, e a documentação do Claude Code diz que os hooks de um deles são deixados de fora, sem dizer qual.
5. Rode `claude plugin list`: deve aparecer um só `gabarito-mestre` habilitado.

A versão 1.1.0 antiga continua no disco depois da atualização (`cache/gabarito-mestre/gabarito-mestre/1.1.0/`), sem ser carregada.

## Rode o onboarding de novo

Quem tem a 1.1.x roda `gabarito-instalar` outra vez. Ele detecta o que o repositório já mostra, faz uma prévia e pergunta no máximo cinco coisas. O onboarding grava o `AGENTS.md.novo` ao lado do seu `AGENTS.md`: revise e aceite (a regra R1 nova vem nele). A Iniciativa, o Epic e o PBI são vinculados depois, por "trocar iniciativa" ou "vincular PBI-<n>" no mesmo `gabarito-instalar`.

## O painel

- Abre sozinho, ao lado, em terminal largo, quando uma entrega começa. Precisa do mod do Claude Code; sem ele não há painel.
- `/gabarito` mostra as opções.
- Detalhado × resumido: `/gabarito painel esquadrao` (plano, equipe, histórico) e `/gabarito painel executivo` (só o essencial). Também há `color`/`mono`, `narracao on|off` e `nomes <pacote>`.
- Desligar: `/gabarito painel desligar` fecha e não abre mais sozinho; só o aviso de que o trabalho PAROU continua. `/gabarito painel ligar` volta.
- `/gabarito pausar` e `/gabarito retomar` param e continuam o trabalho automático da entrega.

## Limites conhecidos

- Os aprendizados e o `registro.md` ficam no repositório local e não chegam a um clone novo.
- A integração com ClickUp e o modo automático não foram ensaiados de ponta a ponta.
- Não foi medido, numa sessão real, qual hook ou skill vence quando 1.1.x e 2.0 ficam instaladas juntas: deixe uma só.
- Repo com o `AGENTS.md` da 1.1.0 (R1 sem a exceção de `release_pr`): o loop para antes do push e do PR e dá ao dono as 2 linhas exatas (`git push -u origin HEAD`; `gh pr create --base <base> --head <branch> …`). O PR sai com um ok do dono. Aplicar o `AGENTS.md.novo` da 2.0.0 remove essa parada. Push e PR no modo `auto` ainda não foram medidos. Se o modo negar, o loop dá as mesmas 2 linhas e para. Merge nunca é do loop.

## Como voltar

A 1.1.0 continua publicada na tag `gabarito-mestre--v1.1.0` do repositório. Para voltar a ela, na ordem:

1. `claude plugin marketplace remove gabarito-mestre` (isso também desinstala o plugin)
2. `claude plugin marketplace add 'gabrielnfc/gabarito-mestre#gabarito-mestre--v1.1.0'`
3. `claude plugin install gabarito-mestre@gabarito-mestre`

Reinicie o Claude Code e rode `claude plugin list`: deve aparecer um só `gabarito-mestre`, na versão 1.1.0, habilitado.

Para voltar à 2.0, na ordem:

1. `claude plugin marketplace remove gabarito-mestre`
2. `claude plugin marketplace add gabrielnfc/gabarito-mestre`
3. `claude plugin install gabarito-mestre@gabarito-mestre`

Para manter a versão por projeto, rode dentro do repo: `claude plugin install gabarito-mestre@gabarito-mestre --scope project`.

Avisos:

- Não pule o `remove`: com o mesmo nome e outra fonte, o `add` falha.
- Não use outro nome de catálogo: o plugin ficaria instalado duas vezes, com o mesmo nome.
