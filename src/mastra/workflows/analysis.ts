/**
 * Workflow `analysis` (Camadas 1+2): triagem → roteamento ao especialista → post_analysis.
 * Estrutura: prepare → foreach(analyze-item, concurrency) → summarize.
 * O roteamento por `tipo` é feito em código dentro do step (alternativa ao `.branch()`),
 * mais simples para 1-de-10 especialistas. 1 falha não aborta o lote (try/catch por item).
 */
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { organizer } from '../agents/organizer';
import { specialists } from '../agents/specialists';
import { workItemSchema, dimensionsSchema, type Dimensions } from '../schemas/common';
import { type SpecialistAnalysis } from '../schemas/post-analysis';
import { specialistOutputSchema } from '../schemas/specialist-payloads';
import { upsertPostAnalysis } from '../lib/repo';
import { fetchWorkItems } from '../lib/silver';
import { runAgent } from '../lib/run-agent';
import { toImagePart } from '../lib/media';
import { runVideoAgent } from '../lib/gemini';

const analysisInput = z.object({
  competitor_id: z.string().uuid(),
  // Opcional: se ausente, os itens são buscados das tabelas Silver (ponte Silver→analysis).
  items: z.array(workItemSchema).optional(),
});

const itemResult = z.object({
  source_id: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
});

const summary = z.object({ total: z.number(), ok: z.number(), failed: z.number() });

const prepare = createStep({
  id: 'prepare-items',
  inputSchema: analysisInput,
  outputSchema: z.array(workItemSchema),
  execute: async ({ inputData }) => {
    if (inputData.items && inputData.items.length > 0) {
      return inputData.items.map((it) => ({ ...it, competitor_id: inputData.competitor_id }));
    }
    return fetchWorkItems(inputData.competitor_id);
  },
});

const analyzeItem = createStep({
  id: 'analyze-item',
  inputSchema: workItemSchema,
  outputSchema: itemResult,
  execute: async ({ inputData: item }) => {
    try {
      // Camada 1 — triagem (9 dimensões)
      const triage = await runAgent<Dimensions>({
        agent: organizer,
        agentName: 'agt-organizer',
        triggerType: 'analysis',
        competitorId: item.competitor_id,
        prompt: `Classifique este item do canal ${item.channel}:\n${JSON.stringify(item)}`,
        schema: dimensionsSchema,
        temperature: 0.2,
        auditInput: { competitor_id: item.competitor_id, channel: item.channel, source_id: item.source_id, stage: 'triage' },
      });
      const dims = triage.object;
      if (!dims) throw new Error('organizer não retornou classificação');

      // Camada 2 — análise por tipo. A Silver sabe se é vídeo (video_url): se houver, força
      // o roteamento p/ Gemini mesmo que o organizer (que só lê texto) tenha dito image/carousel.
      // Ads/reviews mantêm o schema específico; o resto com vídeo vira short/long_video.
      const adOrReview = ['meta_ads', 'google_ads', 'google_reviews', 'reclame_aqui'].includes(dims.tipo);
      const videoTipo = item.channel === 'youtube' ? 'long_video' : 'short_video';
      const effectiveTipo = (item.video_url && !adOrReview ? videoTipo : dims.tipo) as typeof dims.tipo;
      const schema = specialistOutputSchema(effectiveTipo);
      const isVideo = !!item.video_url;
      let analysis: SpecialistAnalysis | undefined;
      let used = `spec-${effectiveTipo}`;
      let modelUsed = process.env.AZURE_OPENAI_DEPLOYMENT ?? null;
      let cost = triage.cost_usd;
      let tin = triage.tokens_in;
      let tout = triage.tokens_out;

      // Vídeo → Gemini vê frames + ouve áudio numa só chamada (nativo).
      if (isVideo) {
        const g = await runVideoAgent<SpecialistAnalysis>({
          agentName: `spec-${effectiveTipo}-gemini`,
          videoUrl: item.video_url!,
          triggerType: 'analysis',
          competitorId: item.competitor_id,
          prompt:
            `Analise este VÍDEO (${effectiveTipo}) do canal ${item.channel}. Leve em conta o que ` +
            `aparece na tela, o que é falado e o gancho de abertura. Contexto:\n${JSON.stringify(item)}`,
          schema,
          temperature: 0.2,
          auditInput: { competitor_id: item.competitor_id, channel: item.channel, source_id: item.source_id, stage: 'specialist-video' },
        });
        if (g?.object) {
          analysis = g.object;
          used = `spec-${effectiveTipo}-gemini`;
          modelUsed = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
          cost += g.cost_usd; tin += g.tokens_in; tout += g.tokens_out;
        }
      }

      // Imagem/texto (Azure, vê o criativo) — também é o fallback se o Gemini não rolou.
      if (!analysis) {
        const imagePart = await toImagePart(item.media_url);
        const specPrompt =
          `Analise este item (${effectiveTipo}) do canal ${item.channel}:\n${JSON.stringify(item)}` +
          (imagePart ? `\n\n(A imagem/capa do criativo está anexada — analise o visual.)` : '');
        const specialist = specialists[effectiveTipo] ?? specialists.image;
        const spec = await runAgent<SpecialistAnalysis>({
          agent: specialist,
          agentName: `spec-${effectiveTipo}`,
          triggerType: 'analysis',
          competitorId: item.competitor_id,
          prompt: specPrompt,
          imageParts: imagePart ? [imagePart] : [],
          schema,
          temperature: 0.2,
          auditInput: { competitor_id: item.competitor_id, channel: item.channel, source_id: item.source_id, stage: 'specialist' },
        });
        if (!spec.object) throw new Error('especialista não retornou análise');
        analysis = spec.object;
        cost += spec.cost_usd; tin += spec.tokens_in; tout += spec.tokens_out;
      }

      await upsertPostAnalysis({
        competitor_id: item.competitor_id,
        channel: item.channel,
        source_table: item.source_table,
        source_id: item.source_id,
        specialist_used: used,
        tipo: effectiveTipo,
        tema_principal: dims.tema_principal,
        temas_secund: dims.temas_secund,
        perfil_alvo: dims.perfil_alvo,
        nivel_tecnico: dims.nivel_tecnico,
        tom: dims.tom,
        tem_prova: dims.tem_prova,
        tem_cta: dims.tem_cta,
        qualidade_leg: dims.qualidade_leg,
        gancho_texto: analysis.gancho_texto,
        tipo_gancho: analysis.tipo_gancho,
        promessa_central: analysis.promessa_central,
        prova_mostrada: analysis.prova_mostrada,
        estrutura: analysis.estrutura,
        cta: analysis.cta,
        specialist_payload: analysis.specialist_payload,
        likes: item.metrics.likes ?? null,
        comments: item.metrics.comments ?? null,
        shares: item.metrics.shares ?? null,
        views: item.metrics.views ?? null,
        posted_at: item.posted_at ?? null,
        model: modelUsed,
        cost_usd: +cost.toFixed(6),
        tokens_in: tin,
        tokens_out: tout,
      });
      return { source_id: item.source_id, ok: true, error: null };
    } catch (err) {
      return {
        source_id: item.source_id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

const summarize = createStep({
  id: 'summarize',
  inputSchema: z.array(itemResult),
  outputSchema: summary,
  execute: async ({ inputData }) => {
    const ok = inputData.filter((r) => r.ok).length;
    return { total: inputData.length, ok, failed: inputData.length - ok };
  },
});

export const analysisWorkflow = createWorkflow({
  id: 'analysis',
  inputSchema: analysisInput,
  outputSchema: summary,
})
  .then(prepare)
  .foreach(analyzeItem, { concurrency: 8 })
  .then(summarize)
  .commit();
