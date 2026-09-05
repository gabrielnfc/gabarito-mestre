/**
 * GATE R3/G7 — trava de ambiente por HOST EFETIVO.
 *
 * Duas travas, um princípio: **o ambiente se identifica pelo host da conexão que
 * vai ser usada agora**, nunca pelo nome do ambiente, pelo `NODE_ENV` nem pelo
 * conteúdo do arquivo de env.
 *
 * Por quê: `NODE_ENV=production` costuma valer em staging e em e2e local, e o
 * arquivo de env pode estar certo enquanto o shell sequestra a variável.
 *
 * REGRA DE OURO DESTE ARQUIVO: nenhuma função aqui IMPRIME um host, uma URL ou uma
 * credencial — nem em erro, nem em log. A comparação é por igualdade; a mensagem
 * diz o que está errado sem dizer o valor.
 */

export class ProductionAccessBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionAccessBlocked';
  }
}

export class BootEnvironmentMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootEnvironmentMismatch';
  }
}

/** Extrai só o host. URL inválida vira `null` — nunca lança, nunca ecoa a entrada. */
export function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Recusa a suíte inteira se o alvo configurado for o mesmo host da produção.
 * Chame nos DOIS entrypoints do runner (setup de env e setup global) — meia trava
 * é a que não protege o caminho que ninguém lembrou.
 *
 * @param targetUrl   URL que os testes vão de fato usar
 * @param productionUrl URL de produção, lida da mesma fonte que a aplicação usaria
 */
export function assertNotProduction(
  targetUrl: string | undefined,
  productionUrl: string | undefined,
  rotulo = 'o sistema externo',
): void {
  const alvo = hostOf(targetUrl);
  const producao = hostOf(productionUrl);

  if (!producao) return; // produção não configurada aqui: nada a comparar
  if (!alvo) {
    throw new ProductionAccessBlocked(
      `[R3] ${rotulo}: a URL de destino é inválida ou ausente. ` +
        `Sem host resolvível não dá para provar que NÃO é produção — a suíte para.`,
    );
  }

  if (alvo === producao) {
    throw new ProductionAccessBlocked(
      `[R3] ${rotulo}: o destino configurado é o MESMO host de produção. ` +
        `Teste automatizado nunca toca produção de terceiro (nem leitura). ` +
        `Aponte para o ambiente de teste e rode de novo. ` +
        `(Os hosts não são impressos de propósito.)`,
    );
  }
}

/**
 * Trava de boot: recusa subir quando o processo vai falar com o host de PRODUÇÃO
 * carregando o marcador de outro ambiente.
 *
 * O DISCRIMINADOR É O HOST, nunca o `APP_ENV`. Resolver o esperado a partir do
 * `APP_ENV` seria circular: o `APP_ENV` é exatamente o que pode estar errado — é ele
 * que o copy-paste de comando de deploy leva junto. O host não mente.
 *
 * "Marcador" é o que quer que separe os ambientes no sistema compartilhado: prefixo de
 * namespace, sufixo de fila, schema, database index.
 *
 * @param effectiveHost   host da conexão que o processo vai usar AGORA
 * @param sandboxMarkers  substrings que identificam ambiente de teste ('sandbox', 'localhost')
 * @param productionMarker marcador que o ambiente de produção DEVE usar
 * @param resolved        marcador que este processo realmente resolveu
 */
export function assertBootEnvironment(
  effectiveHost: string | null,
  sandboxMarkers: readonly string[],
  productionMarker: string,
  resolved: string,
): void {
  if (!effectiveHost) return; // sem host, o processo não fala com ninguém: nada a travar
  if (sandboxMarkers.some((m) => effectiveHost.includes(m))) return; // ambiente de teste: não julga

  if (resolved !== productionMarker) {
    throw new BootEnvironmentMismatch(
      `[G7] ambiente inconsistente: o host efetivo é o de PRODUÇÃO, mas este processo ` +
        `resolveu o marcador "${resolved}" em vez de "${productionMarker}". O processo NÃO sobe. ` +
        `Isto pega o copy-paste de comando de deploy entre ambientes — que, passando, ` +
        `faria este processo escrever no namespace de outro, sem erro em lugar nenhum.`,
    );
  }
}
