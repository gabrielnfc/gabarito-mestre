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
3. Quem testou a pré-versão (`#next`): `claude plugin uninstall gabarito-mestre@gabarito-mestre-next --scope project` e `claude plugin marketplace remove gabarito-mestre-next`. Senão ficam dois plugins com o mesmo nome, e a documentação do Claude Code diz que os hooks de um deles são deixados de fora, sem dizer qual.
4. Quer a 2.0 em um repositório só, antes de atualizar o resto: instale a pré-versão nele e rode `claude plugin disable gabarito-mestre@gabarito-mestre --scope project` (de preferência em `settings.local.json`; o `settings.json` commitado vale para todo mundo que clonar o repositório).
5. Rode `claude plugin list`: deve aparecer um só `gabarito-mestre` habilitado.

A versão 1.1.0 antiga continua no disco depois da atualização (`cache/gabarito-mestre/gabarito-mestre/1.1.0/`), sem ser carregada.

## Rode o onboarding de novo

Quem tem a 1.1.x roda `gabarito-instalar` outra vez. Ele detecta o que o repositório já mostra, faz uma prévia e pergunta no máximo cinco coisas. A Iniciativa, o Epic e o PBI são vinculados depois, por "trocar iniciativa" ou "vincular PBI-<n>" no mesmo `gabarito-instalar`.

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

## Como voltar

A 1.1.0 continua publicada na tag `gabarito-mestre--v1.1.0` do repositório. Depois de voltar, rode `claude plugin list` e confira que há um só `gabarito-mestre` habilitado.
