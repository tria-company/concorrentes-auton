/** Smoke test: organizer (Camada 1) via Azure OpenAI com saída estruturada.
 *  Rodar:  npx tsx --env-file=.env scripts/smoke-organizer.ts  */
import { mastra } from '../src/mastra/index';
import { dimensionsSchema } from '../src/mastra/schemas/common';

const agent = mastra.getAgentById('agt-organizer');
const res = await agent.generate(
  'Item do Instagram: imagem de feed com a legenda "Agende sua teleconsulta de medicina ' +
    'integrativa" e um selo de aprovação de pacientes.',
  { structuredOutput: { schema: dimensionsSchema } },
);
console.log('RESULTADO:', JSON.stringify(res.object, null, 2));
