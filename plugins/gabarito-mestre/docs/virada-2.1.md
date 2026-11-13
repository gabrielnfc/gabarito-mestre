# Virada para a 2.1.0

Para quem usa o Gabarito Mestre. O que mudou em detalhe está no `CHANGELOG.md`, seção `[2.1.0]`; aqui, o que muda no dia a dia e o que fazer.

## O que muda da 2.0

- **Um painel só, em um local só.** Você escolhe onde ele fica: ao lado da conversa (padrão; só em tela cheia com 110 colunas ou mais, senão a plataforma o põe acima da linha de digitar) ou acima da linha de digitar. Nunca os dois ao mesmo tempo.
- **O painel diz o que depende de você**, mesmo antes de existir uma entrega em curso, e só mostra o que tem registro: sem fonte, aparece "?" em vez de um número inventado.
- **O orquestrador anota na hora.** Ideia nova, desvio, mudança de assunto, dúvida que só você resolve e tarefa sua fora da entrega viram uma anotação de uma linha, nas palavras dele, sem plano e sem interromper o trabalho.
- **O chat fica mais limpo.** As linhas de ferramenta aparecem em linguagem natural ("consultou 3 arquivos"). Quem prefere o texto cru escolhe `/gabarito chat cru`.
- **Modo foco, só com o seu ok.** O onboarding oferece o chat só com a sua pergunta, um resumo do que a IA fez e a resposta. Fica no arquivo pessoal `.claude/settings.local.json` (fora do git) e se desfaz apagando as chaves `viewMode` e `tui` desse arquivo.
- **O pouso pede para limpar a conversa.** Perto de metade do contexto, o loop grava o ponto de retomada, arma o retorno e pede que você limpe a conversa. Enquanto isso não acontece, nada novo é despachado; o que já está em andamento termina.
- **Os aprendizados chegam a um clone novo.** As regras comprovadas ficam versionadas no repositório e voltam sozinhas ao brief do agente que as precisa.

## Onde fica o painel

Pane (lateral): ao lado só em tela cheia com ≥ 110 colunas; fora disso a própria plataforma a põe acima da linha de digitar — sempre um só local. O gabarito nunca troca de local sozinho pela largura da janela.

Para trocar, digite `/gabarito painel lateral` ou `/gabarito painel acima`; para esconder, `/gabarito painel ocultar` (o aviso de PAROU e a pergunta aberta continuam aparecendo) e `/gabarito painel mostrar` para voltar. O painel precisa do mod do Claude Code.

## O que fazer ao atualizar

1. Atualize o plugin como na 2.0 (veja `docs/virada-2.0.md`, na raiz do repositório, seção "Como atualizar") e digite `/reload-plugins`.
2. Abra uma sessão nova: o resumo de início mostra a linha "sessão <id>", que o loop usa para medir o contexto.
3. Se quiser mudar o local do painel ou o modo foco, rode o onboarding de novo (`gabarito-instalar`, "trocar") ou use os comandos acima.

## Como voltar à 2.0.0

Reinstale a 2.0.0 do plugin pelos passos de "Como voltar" em `docs/virada-2.0.md`. Para desfazer o foco, apague `viewMode` e `tui` de `.claude/settings.local.json`.

## Limites desta versão

- A herança das regras de repositórios da 1.x (`onboarding.mjs herdar`) chega na 2.2; não existe na 2.1.0.
- Sem o mod, não há painel, push de aviso nem `/clear` automático: o loop pede a você, em uma linha, que digite `/clear`.
- Os limites declarados do painel e do chat (o que foi medido e o que não foi) estão em `commands/gabarito.md`, seção "O que só o mod entende".
