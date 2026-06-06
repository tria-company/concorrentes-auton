/** Smoke: organizer → especialista (com payload por tipo) via Azure.
 *  Rodar: npx tsx --env-file=.env scripts/smoke-analysis.ts  */
import { organizer } from '../src/mastra/agents/organizer';
import { specialists } from '../src/mastra/agents/specialists';
import { dimensionsSchema } from '../src/mastra/schemas/common';
import { specialistOutputSchema } from '../src/mastra/schemas/specialist-payloads';

const item = {
  channel: 'meta_ads',
  text:
    'Cansado de perder pacientes por causa da agenda bagunçada? Conheça o software de gestão ' +
    'clínica nº 1 do Brasil. Agenda online, prontuário e teleconsulta. Mais de 5.000 clínicas ' +
    'confiam. Teste grátis por 7 dias — comece agora!',
};

const triage = await organizer.generate(
  `Classifique este anúncio de um concorrente:\n${JSON.stringify(item)}`,
  { structuredOutput: { schema: dimensionsSchema } },
);
const dims = triage.object;
if (!dims) throw new Error('sem classificação');
console.log('TIPO:', dims.tipo, '| TEMA:', dims.tema_principal, '| tem_cta:', dims.tem_cta);

const res = await specialists[dims.tipo].generate(
  `Analise este item (${dims.tipo}):\n${JSON.stringify(item)}`,
  { structuredOutput: { schema: specialistOutputSchema(dims.tipo) } },
);
console.log('ANALISE:', JSON.stringify(res.object, null, 2));
