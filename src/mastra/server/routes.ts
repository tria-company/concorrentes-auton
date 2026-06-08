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
      const token = process.env.APIFY_TOKEN;
      if (!token) return c.json({ error: 'APIFY_TOKEN ausente' }, 500);

      const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
      // O payload do Apify pode vir com `resource` populado OU só com `eventData.actorRunId`
      // (caso de webhooks TEST ou se o template `{{resource.*}}` não renderizar). Aceitamos ambos.
      const runId: string | null =
        body.runId ?? body.resource?.id ?? body.eventData?.actorRunId ?? null;
      if (!runId) return c.json({ error: 'missing runId' }, 400);

      // (1) SEMPRE busca os detalhes da run — single source of truth pra actId + datasetId.
      // Se algum dia o body do webhook estiver completo, ainda assim é só 1 round-trip extra de ~100ms.
      const runRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
      if (!runRes.ok) {
        return c.json({ error: `actor-run HTTP ${runRes.status}` }, 502);
      }
      const runData = ((await runRes.json()) as { data?: any })?.data ?? {};
      const datasetId: string | null = runData.defaultDatasetId ?? body.resource?.defaultDatasetId ?? null;
      const actId: string | null = runData.actId ?? body.actorId ?? body.actor_id ?? body.resource?.actId ?? null;
      if (!datasetId) return c.json({ error: 'run sem defaultDatasetId' }, 422);

      // (2) INPUT do run no KV store contém `_autonMeta` (source + competitor_id) injetado pelo setup-apify-schedules.ts
      let meta: { competitor_id?: string | null; source?: string | null } = {};
      try {
        const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/key-value-store/records/INPUT?token=${token}`);
        if (r.ok) meta = ((await r.json()) as Record<string, any>)?._autonMeta ?? {};
      } catch { /* meta vazia */ }

      // (3) Items do dataset
      const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true&format=json`);
      if (!itemsRes.ok) {
        const t = await itemsRes.text().catch(() => '');
        return c.json({ error: `dataset HTTP ${itemsRes.status}: ${t.slice(0, 200)}` }, 502);
      }
      const items = (await itemsRes.json()) as unknown[];

      const wf = c.get('mastra').getWorkflowById('ingestion');
      const run = await wf.createRun({ runId: makeRunId('ingestion', runId) });
      const started: any = await run.startAsync({
        inputData: {
          source: meta.source ?? 'unknown',
          apify_actor: actId ?? 'unknown',
          apify_run_id: runId,
          competitor_id: meta.competitor_id ?? null,
          payload: items,
        },
      } as any);
      return c.json({
        ok: true,
        runId: started?.runId ?? null,
        items: Array.isArray(items) ? items.length : 0,
        source: meta.source ?? 'unknown',
        competitor_id: meta.competitor_id ?? null,
      });
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
