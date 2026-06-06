/**
 * Rotas HTTP customizadas do servidor Mastra (EPIC 8 · triggers).
 *  - POST /webhooks/apify        → autentica x-apify-secret e dispara `ingestion`.
 *  - GET  /cron/dispatch         → autentica Bearer CRON_SECRET; dispara 1 workflow (global ou ?competitor_id=).
 *  - GET  /cron/dispatch-all     → idem, mas faz fan-out: 1 run por concorrente ativo.
 * Vercel Cron chama os GET /cron/* (cron in-code do Mastra não roda em serverless).
 */
import { registerApiRoute } from '@mastra/core/server';
import { supabase } from '../lib/supabase';
import { makeRunId } from '../lib/idempotency';

function cronAuthorized(authHeader: string | undefined): boolean {
  return !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

/** Dia corrente (UTC) para runId determinístico por cadência. */
const today = () => new Date().toISOString().slice(0, 10);

export const apiRoutes = [
  registerApiRoute('/webhooks/apify', {
    method: 'POST',
    handler: async (c) => {
      const secret = c.req.header('x-apify-secret');
      if (!process.env.APIFY_WEBHOOK_SECRET || secret !== process.env.APIFY_WEBHOOK_SECRET) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
      const wf = c.get('mastra').getWorkflowById('ingestion');
      const run = await wf.createRun({
        runId: makeRunId('ingestion', body.runId ?? body.resource?.id ?? body),
      });
      const started: any = await run.startAsync({
        inputData: {
          source: body.source ?? body.eventType ?? 'unknown',
          apify_actor: body.actorId ?? body.actor_id ?? null,
          apify_run_id: body.runId ?? body.resource?.id ?? null,
          competitor_id: body.competitor_id ?? null,
          payload: body,
        },
      } as any);
      return c.json({ ok: true, runId: started?.runId ?? null });
    },
  }),

  registerApiRoute('/cron/dispatch', {
    method: 'GET',
    handler: async (c) => {
      if (!cronAuthorized(c.req.header('authorization'))) return c.json({ error: 'unauthorized' }, 401);
      const workflow = c.req.query('workflow');
      const competitorId = c.req.query('competitor_id');
      if (!workflow) return c.json({ error: 'param `workflow` obrigatório' }, 400);

      let wf;
      try {
        wf = c.get('mastra').getWorkflowById(workflow);
      } catch {
        return c.json({ error: `workflow ${workflow} não encontrado` }, 404);
      }

      const run = await wf.createRun({ runId: makeRunId(workflow, { competitorId, day: today() }) });
      const started: any = await run.startAsync({
        inputData: (competitorId ? { competitor_id: competitorId } : {}) as any,
      } as any);
      return c.json({ ok: true, workflow, runId: started?.runId ?? null });
    },
  }),

  registerApiRoute('/cron/dispatch-all', {
    method: 'GET',
    handler: async (c) => {
      if (!cronAuthorized(c.req.header('authorization'))) return c.json({ error: 'unauthorized' }, 401);
      const workflow = c.req.query('workflow');
      if (!workflow) return c.json({ error: 'param `workflow` obrigatório' }, 400);

      let wf;
      try {
        wf = c.get('mastra').getWorkflowById(workflow);
      } catch {
        return c.json({ error: `workflow ${workflow} não encontrado` }, 404);
      }

      const { data, error } = await supabase().from('competitors').select('id').eq('active', true);
      if (error) return c.json({ error: error.message }, 500);
      const ids = (data ?? []).map((r: { id: string }) => r.id);

      let dispatched = 0;
      for (const competitor_id of ids) {
        try {
          const run = await wf.createRun({ runId: makeRunId(workflow, { competitor_id, day: today() }) });
          await run.startAsync({ inputData: { competitor_id } as any } as any);
          dispatched++;
        } catch (e) {
          console.warn(`[cron] ${workflow} competitor=${competitor_id}:`, (e as Error).message);
        }
      }
      return c.json({ ok: true, workflow, dispatched });
    },
  }),
];
