/** Contexto de domínio compartilhado por todos os agentes do pipeline. */

export const DOMAIN_CONTEXT = `# Contexto
A Auton Health é uma healthtech brasileira de **medicina integrativa**. Posicionamento travado:
"a 1ª IA de causa raiz, agora em rede — a plataforma sistêmica da saúde integrativa"
(diagnóstico inteligente + discussão entre colegas + rede de apoio multidisciplinar).

Este pipeline faz **inteligência competitiva**: analisa o conteúdo público dos concorrentes
(Amigo Tech, VOA Health, LifeUp, Amplimed, HiDoctor e similares) para revelar:
(a) o que funciona na comunicação deles (ganchos, promessas, provas);
(b) lacunas e dores exploráveis pela Auton;
(c) sinais de leads quentes (clientes insatisfeitos prontos para migrar).

# Regra de ouro
NÃO invente. Extraia apenas o que está EXPLÍCITO no conteúdo fornecido. Quando um dado não
existir, retorne null (ou lista vazia). Seja específico, conciso e acionável — nada de floreio.`;

/** Compõe as instruções de um agente com o contexto de domínio no topo. */
export function withContext(role: string): string {
  return `${DOMAIN_CONTEXT}\n\n# Seu papel\n${role}`;
}
