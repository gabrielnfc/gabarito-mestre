# Adoção e calibragem

Este arquivo resolve o defeito mais perigoso de um harness: **regra sem gate é intenção**, e num repositório novo quase tudo começa assim. Aqui está como sair do zero sem mentir para si mesmo pelo caminho.

Leia junto com `AGENTS.md §0.2` (Estado deste harness), que é a tabela que você mantém preenchida.

---

## 1. A escada

Adote por níveis. **Nunca declare um nível que os gates não sustentam** — o §0.2 é auditável, e um nível inflado é a mesma mentira que a Regra de Ouro proíbe.

### Nível 0 — nenhum gate (ponto de partida honesto)

Todo repo começa aqui. Vale escrever isso no §0.2 em vez de fingir.

- [ ] `AGENTS.md` na raiz, com o Apêndice preenchido.
- [ ] Todas as regras marcadas **(b)** no §0.2, com dono e prazo.
- [ ] Nenhum agente opera sem ter lido o §1 (pare e pergunte).

**O que já funciona sem nenhum gate:** §1 inteiro, §4 (invariantes de raciocínio) e a marcação (a)/(b)/(c). São disciplina de julgamento, não de máquina — e são o que evita os incidentes mais caros.

### Nível 1 — segurança (a prioridade absoluta)

Aqui param os acidentes irreversíveis. **Nenhum projeto deveria operar com agentes abaixo deste nível.**

- [ ] **G3** — guarda de mutação em massa + checagem estrita de `undefined` no client de banco *(R2)*.
- [ ] **Teardown por id** em toda suíte, com `if (!id) return` *(R2, R12)*.
- [ ] **Trava de credencial de produção**: comparação de host que impede a suíte de rodar contra produção, sem imprimir nenhum dos lados *(R3)*.
- [ ] **Segredo fora do repo**: arquivo de exemplo com valores vazios, gitignore conferido, scanner de segredo no CI *(R3)*.
- [ ] **Branch protegida** — nada entra sem PR *(R1)*.
- [ ] **Backup verificado por read-back**: censo de linhas no arquivo gerado, não só a existência do arquivo.

> O incidente que motiva este nível: uma base local sem backup foi apagada por um `where` vazio. G3 sozinho teria impedido; o backup verificado teria tornado irrelevante.

### Nível 2 — processo

Aqui o trabalho passa a ser reproduzível por outro agente ou outra pessoa.

- [ ] `docs/specs/` · `docs/plans/` · `docs/backlog.md` · ledger **versionado**.
- [ ] Convenções de nome de spec, plano, ledger e branch **escritas** no Apêndice (na maioria dos projetos elas são (c) tácitas).
- [ ] Template de PR: requisito que fecha · migration compatível com a versão no ar · plano de volta se destrutiva · janela de deploy declarada · teardown conferido.
- [ ] Prompts de papel versionados (`prompts.md`), não improvisados por sessão.
- [ ] Lanes de teste declaradas, com a partição hermética × não-hermética em **fonte única**, e quais são obrigatórias.
- [ ] Jobs obrigatórios no ruleset, incluindo a **guarda de migrations** (G8).
- [ ] Ciclo RED→GREEN registrado no ledger *(R13)*.

### Nível 3 — completo

- [ ] **G1, G2, G4, G5, G6, G7, G9** implementadas ou **declaradas ausentes com dono**.
- [ ] Pacote de contratos compartilhado + teste do barril.
- [ ] Ratchet de qualidade com baseline commitado e guarda fail-closed do universo de cobertura.
- [ ] Teste que trava a ordem de subida (não um teste que confere se o comentário existe).
- [ ] Endpoint de saúde com commit e versão + smoke que **mede** o bundle servido.
- [ ] Identidade federada, pool por ambiente, sem chave estática.
- [ ] Teste que congela o estado de RLS, com sweep dinâmico do catálogo.
- [ ] Revisão do harness com dono e cadência *(AGENTS.md §8)*.

---

## 2. Ordem de implantação sugerida

Se você tem pouco tempo, esta é a ordem por retorno sobre risco:

1. **G3 + teardown por id** — impede o acidente irreversível.
2. **Trava de produção** — impede o acidente que atinge terceiros.
3. **Guarda de migrations (G8)** — impede o acidente que o rollback de imagem não desfaz.
4. **Ordem de subida travada por teste** — impede o erro silencioso, que é o pior de todos.
5. **Ratchet** — impede a erosão lenta.
6. O resto.

---

## 3. Calibragem — meça antes de ligar

Os parâmetros da `referencia.md §5` vieram de um projeto real. **Copiar sem medir é herdar a calibragem de outra pessoa.**

| Parâmetro | Valor de partida | Como calibrar |
|---|---|---|
| Massa suspeita (G4) | ≥20% **e** ≥5 registros | rode a guarda em modo relatório sobre o histórico real; ajuste até não disparar em passada legítima |
| Teto de páginas (G1) | 200 | maior censo real × 3 |
| Corte temporal da guarda de migrations (G8) | data em que a guarda entrou | rode contra todas as migrations existentes **antes de ligar** e conte falsos positivos; sem corte, a primeira PR de integração trava para sempre |
| Padrão destrutivo (G8) | `DROP TABLE\|COLUMN\|TYPE\|SCHEMA\|SEQUENCE\|DATABASE`, `TRUNCATE`, `UPDATE`, `DELETE`, isentando ação referencial de FK | sem a isenção de FK, 11 de 36 migrations davam falso-positivo no projeto de origem |
| Tolerância do ratchet | 0,5 ponto percentual | ruído natural entre runs; meça o seu |
| Teto de duplicação | medição atual + folga pequena | teto fixo, sem aceite |
| Tamanho de PR que dispara pergunta | ~15 arquivos de produção | é sinal para pensar, não regra dura |
| Teto de tempo por lane | medido, nunca ausente | pior caso observado × 2 |

**Toda calibragem entra no Apêndice do `AGENTS.md`**, com a data da medição. Parâmetro sem data é parâmetro herdado.

---

## 4. O que NÃO adotar sem pensar

Nem tudo que funciona num projeto generaliza. Estes itens são calibragem local disfarçada de boa prática:

| Item | Por que é local |
|---|---|
| **Golden fixture byte-a-byte** | só se justifica contra sistema sensível a ordem/bytes. Em projeto normal, snapshot semântico basta. |
| **Proibir mock da fronteira externa** (R7) | depende de existir ambiente real de teste. Sem sandbox, é inaplicável — declare no Apêndice. |
| **Autorização nominal "uma consulta = um pedido"** (R3) | nasce de sistema de terceiro vivo com auditoria própria. O princípio generaliza; esse rigor é calibragem. |
| **100% de cobertura de funções num pacote** | disciplina cara, adotada por decisão. Não é boa prática universal. |
| **Prefixo de namespace por ambiente + trava de boot** (G7) | resolve ambiente de teste **compartilhado** entre estágios. Ambientes isolados não precisam. |
| **Ferramenta pessoal no caminho da medição** | qualquer proxy entre o agente e a medição pode corromper a conclusão em silêncio (I5). Em projeto novo: não coloque. |

---

## 5. Quando o harness não serve

Diga em voz alta, em vez de adotar pela metade:

- **Time humano grande.** Este harness assume orquestração por uma pessoa sênior com agentes. Um time de várias pessoas precisa de ownership por área, arbitragem de desacordo e cultura de review — nada disso está aqui.
- **Protótipo descartável.** §1 continua valendo (delete e produção alheia machucam igual). O resto é custo sem retorno.
- **Repositório sem CI.** Fique no Nível 1 até existir CI; declarar Nível 3 sem pipeline é a mentira que o §0.2 existe para pegar.

---

## 6. Autodiagnóstico trimestral

Cinco perguntas. Se alguma resposta for "não sei", a resposta é "não".

1. O §0.2 foi reconferido **por medição** nos últimos 90 dias?
2. Existe alguma regra marcada (a) cujo gate ninguém consegue apontar?
3. Existe algum item no backlog entregue ou revogado que ninguém riscou?
4. O último incidente virou regra, gate ou anti-padrão — ou sumiu?
5. Alguma lane obrigatória está sendo ignorada na prática (vermelha crônica, pulada, ou não-obrigatória sem estar declarada)?
