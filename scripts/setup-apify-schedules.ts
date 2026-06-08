/**
 * Configura no Apify (programaticamente, via API) TUDO o que precisa pra extração
 * automática rodar sozinha: 1 task por (perfil × actor), 1 schedule por task e 1
 * webhook que aponta pra VPS. Cobre os 2 projetos (Concorrentes + Batalhão).
 *
 * Idempotente: usa nomes determinísticos (`auton-<projeto>-<handle>-<canal>`) e faz
 * UPDATE quando já existe — pode rodar quantas vezes quiser.
 *
 * Env (no .env local do dev — não no container):
 *   APIFY_TOKEN, APIFY_WEBHOOK_SECRET
 *   SUPABASE_URL,             SUPABASE_SERVICE_ROLE_KEY              (Concorrentes)
 *   SUPABASE_URL_BATALHAO,    SUPABASE_SERVICE_ROLE_KEY_BATALHAO     (Batalhão)
 *   WEBHOOK_URL_CONCORRENTES  (ex.: https://painel.<dominio>/webhooks/apify)
 *   WEBHOOK_URL_BATALHAO      (ex.: https://batalhao.<dominio>/webhooks/apify)
 *   DRY_RUN=1 (opcional) — só imprime o que faria
 *
 * Uso: tsx scripts/setup-apify-schedules.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config';

const TOKEN = required('APIFY_TOKEN');
const WEBHOOK_SECRET = required('APIFY_WEBHOOK_SECRET');
const WURL_CONC = required('WEBHOOK_URL_CONCORRENTES');
const WURL_BAT = process.env.WEBHOOK_URL_BATALHAO?.trim() ?? '';
const DRY = process.env.DRY_RUN === '1';

const SB_CONC = {
  url: required('SUPABASE_URL'),
  key: required('SUPABASE_SERVICE_ROLE_KEY'),
};
// Batalhão opcional — só configurado se as vars estiverem presentes.
const SB_BAT_URL = process.env.SUPABASE_URL_BATALHAO?.trim() ?? '';
const SB_BAT_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_BATALHAO?.trim() ?? '';
const HAS_BAT = !!(SB_BAT_URL && SB_BAT_KEY && WURL_BAT);
const SB_BAT = HAS_BAT ? { url: SB_BAT_URL, key: SB_BAT_KEY } : null;

function required(k: string): string {
  const v = process.env[k];
  if (!v || !v.trim()) throw new Error(`env ausente: ${k}`);
  return v.trim();
}

// -------------------- catálogo de actors --------------------
// (project, channel) → actorId Apify (slug `username/name`) + inputBuilder + cron.

type Channel =
  | 'ig-reels' | 'ig-posts' | 'tiktok' | 'youtube'
  | 'fb-posts' | 'fb-ads' | 'google-ads' | 'google-reviews' | 'reclame-aqui';

interface Profile { id: string; handle: string; extra?: Record<string, string | null>; }

interface ActorSpec {
  channel: Channel;
  actor: string;                       // 'apify~instagram-reel-scraper' etc.
  cron: string;                        // expressão cron (UTC)
  needs?: (p: Profile) => boolean;     // requisito de campo no perfil
  buildInput: (p: Profile) => Record<string, unknown>;
  resultsLimit?: number;
}

const PER_PROFILE_LIMIT = 100; // ajustável; webhook do dataset captura tudo.

// Mapeia channel → source canônico (chaves do parser em lib/parser.ts).
// O webhook handler lê `_autonMeta.source` pra escolher o parser certo.
const CHANNEL_TO_SOURCE: Record<Channel, string> = {
  'ig-reels': 'instagram',
  'ig-posts': 'instagram',
  'tiktok': 'tiktok',
  'youtube': 'youtube',
  'fb-posts': 'facebook',
  'fb-ads': 'meta_ads',
  'google-ads': 'google_ads',
  'google-reviews': 'google_reviews',
  'reclame-aqui': 'reclame_aqui',
};

// ----- Catálogo Concorrentes -----
const ACTORS_CONC: ActorSpec[] = [
  { channel: 'ig-reels', actor: 'apify~instagram-reel-scraper', cron: '0 3 * * *',
    needs: p => !!p.extra?.ig_handle,
    buildInput: p => ({ username: [strip(p.extra!.ig_handle!)], resultsLimit: PER_PROFILE_LIMIT }) },
  { channel: 'ig-posts', actor: 'apify~instagram-scraper', cron: '0 3 * * *',
    needs: p => !!p.extra?.ig_handle,
    buildInput: p => ({ directUrls: [`https://www.instagram.com/${strip(p.extra!.ig_handle!)}/`], resultsType: 'posts', resultsLimit: PER_PROFILE_LIMIT }) },
  { channel: 'tiktok', actor: 'clockworks~tiktok-scraper', cron: '15 3 * * *',
    needs: p => !!p.extra?.tiktok_handle,
    buildInput: p => ({ profiles: [strip(p.extra!.tiktok_handle!)], resultsPerPage: PER_PROFILE_LIMIT, shouldDownloadVideos: false, shouldDownloadCovers: false }) },
  { channel: 'fb-posts', actor: 'apify~facebook-posts-scraper', cron: '30 3 * * *',
    needs: p => !!p.extra?.fb_page_url,
    buildInput: p => ({ startUrls: [{ url: p.extra!.fb_page_url! }], resultsLimit: PER_PROFILE_LIMIT }) },
  { channel: 'fb-ads', actor: 'apify~facebook-ads-scraper', cron: '0 4 * * *',
    needs: p => !!p.extra?.fb_page_url,
    buildInput: p => ({ startUrls: [{ url: p.extra!.fb_page_url! }], resultsLimit: PER_PROFILE_LIMIT }) },
  { channel: 'google-ads', actor: 'solidcode~ads-transparency-scraper', cron: '30 4 * * *',
    buildInput: p => ({ search: p.handle, region: 'BR', maxItems: PER_PROFILE_LIMIT }) },
  { channel: 'google-reviews', actor: 'compass~crawler-google-places', cron: '0 5 * * *',
    needs: p => !!p.extra?.google_place_id,
    buildInput: p => ({ placeIds: [p.extra!.google_place_id!], maxReviews: 100, reviewsSort: 'newest' }) },
  { channel: 'reclame-aqui', actor: 'solidcode~reclameaqui-scraper', cron: '0 2 * * 1',
    needs: p => !!p.extra?.ra_company_slug,
    buildInput: p => ({ companies: [p.extra!.ra_company_slug!], maxItems: 100 }) },
  { channel: 'youtube', actor: 'streamers~youtube-channel-scraper', cron: '45 3 * * *',
    needs: p => !!p.extra?.yt_channel_id,
    buildInput: p => ({ startUrls: [{ url: `https://www.youtube.com/channel/${p.extra!.yt_channel_id!}/videos` }], maxResultsShorts: 0, maxResults: PER_PROFILE_LIMIT }) },
];

// ----- Catálogo Batalhão (só IG + TikTok via Apify; YouTube via yt-dlp no /cron/scrape-youtube) -----
const ACTORS_BAT: ActorSpec[] = [
  { channel: 'ig-posts', actor: 'apify~instagram-profile-scraper', cron: '30 3 * * *',
    buildInput: p => ({ usernames: [p.handle], resultsType: 'posts', resultsLimit: 50 }) },
  { channel: 'tiktok', actor: 'clockworks~tiktok-scraper', cron: '45 3 * * *',
    buildInput: p => ({ profiles: [p.handle], resultsPerPage: 50, shouldDownloadVideos: false, shouldDownloadCovers: false }) },
];

function strip(h: string): string { return (h || '').replace(/^@/, '').trim(); }

// -------------------- Apify API helpers --------------------

async function apify<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.apify.com/v2${path}${sep}token=${TOKEN}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Apify ${method} ${path}: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: T } & T;
  return (json?.data ?? json) as T;
}

async function listAll<T extends { id: string; name?: string }>(path: string): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await apify<{ items: T[]; total: number }>('GET', `${path}?limit=1000&offset=${offset}&desc=1`);
    out.push(...(page.items ?? []));
    if (!page.items?.length || out.length >= page.total) break;
    offset += page.items.length;
  }
  return out;
}

// -------------------- Supabase fetch (PostgREST, sem cliente) --------------------

async function fetchProfiles(sb: { url: string; key: string }, table: string, select: string): Promise<any[]> {
  const r = await fetch(`${sb.url}/rest/v1/${table}?select=${encodeURIComponent(select)}`, {
    headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}` },
  });
  if (!r.ok) throw new Error(`Supabase ${table}: HTTP ${r.status}`);
  return (await r.json()) as any[];
}

// -------------------- Upserts idempotentes --------------------

interface Existing { tasks: any[]; schedules: any[]; webhooks: any[]; }
async function loadExisting(): Promise<Existing> {
  const [tasks, schedules, webhooks] = await Promise.all([
    listAll<any>('/actor-tasks'),
    listAll<any>('/schedules'),
    listAll<any>('/webhooks'),
  ]);
  return { tasks, schedules, webhooks };
}

function nameFor(project: 'conc' | 'bat', handle: string, channel: Channel): string {
  // Apify names: até 63 chars, [a-zA-Z0-9-_]. Sanitiza.
  const h = handle.toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 28);
  return `auton-${project}-${h}-${channel}`;
}

async function upsertTask(ex: Existing, name: string, actor: string, input: Record<string, unknown>): Promise<string> {
  const found = ex.tasks.find((t) => t.name === name);
  const body = { actId: actor, name, options: { memoryMbytes: 1024, timeoutSecs: 3600 }, input };
  if (found) {
    if (DRY) { console.log(`  [DRY] UPDATE task ${name}`); return found.id; }
    await apify('PUT', `/actor-tasks/${found.id}`, body);
    return found.id;
  }
  if (DRY) { console.log(`  [DRY] CREATE task ${name}`); return 'dry-task-id'; }
  const created = await apify<any>('POST', '/actor-tasks', body);
  ex.tasks.push(created);
  return created.id;
}

async function upsertSchedule(ex: Existing, name: string, taskId: string, cron: string): Promise<void> {
  const found = ex.schedules.find((s) => s.name === name);
  const body = {
    name,
    cronExpression: cron,
    timezone: 'UTC',
    isEnabled: true,
    actions: [{ type: 'RUN_ACTOR_TASK', actorTaskId: taskId }],
  };
  if (found) {
    if (DRY) { console.log(`  [DRY] UPDATE schedule ${name}`); return; }
    await apify('PUT', `/schedules/${found.id}`, body);
    return;
  }
  if (DRY) { console.log(`  [DRY] CREATE schedule ${name}`); return; }
  const created = await apify('POST', '/schedules', body);
  ex.schedules.push(created as any);
}

async function upsertWebhook(ex: Existing, name: string, taskId: string, url: string): Promise<void> {
  const found = ex.webhooks.find((w) => w.description === name);
  const body = {
    description: name,
    eventTypes: ['ACTOR.RUN.SUCCEEDED'],
    condition: { actorTaskId: taskId },
    requestUrl: url,
    headersTemplate: JSON.stringify({ 'x-apify-secret': WEBHOOK_SECRET, 'content-type': 'application/json' }),
    payloadTemplate: JSON.stringify({
      eventType: '{{eventType}}',
      resource: { id: '{{resource.id}}', actId: '{{resource.actId}}', defaultDatasetId: '{{resource.defaultDatasetId}}' },
    }),
  };
  if (found) {
    if (DRY) { console.log(`  [DRY] UPDATE webhook ${name}`); return; }
    await apify('PUT', `/webhooks/${found.id}`, body);
    return;
  }
  if (DRY) { console.log(`  [DRY] CREATE webhook ${name}`); return; }
  const created = await apify('POST', '/webhooks', body);
  ex.webhooks.push(created as any);
}

// -------------------- main --------------------

async function setupFor(
  project: 'conc' | 'bat',
  profiles: Profile[],
  actors: ActorSpec[],
  webhookUrl: string,
  ex: Existing,
): Promise<{ tasks: number; skipped: number }> {
  let tasks = 0, skipped = 0;
  for (const p of profiles) {
    for (const a of actors) {
      if (a.needs && !a.needs(p)) { skipped++; continue; }
      const name = nameFor(project, p.handle, a.channel);
      // Injeta metadata pra o webhook handler saber (a) qual concorrente e (b) qual parser usar.
      const input = { ...a.buildInput(p), _autonMeta: { competitor_id: p.id, source: CHANNEL_TO_SOURCE[a.channel] } };
      try {
        const taskId = await upsertTask(ex, name, a.actor, input);
        await upsertSchedule(ex, name, taskId, a.cron);
        await upsertWebhook(ex, name, taskId, webhookUrl);
        console.log(`  ✓ ${name}`);
        tasks++;
      } catch (e) {
        console.log(`  ✗ ${name}: ${(e as Error).message}`);
      }
    }
  }
  return { tasks, skipped };
}

(async () => {
  console.log(`Apify setup ${DRY ? '[DRY-RUN]' : ''} — coletando inventário…`);
  const ex = await loadExisting();
  console.log(`  existentes: tasks=${ex.tasks.length}, schedules=${ex.schedules.length}, webhooks=${ex.webhooks.length}`);

  console.log('\n== Concorrentes ==');
  const compsRaw = await fetchProfiles(SB_CONC, 'competitors',
    'id,name,ig_handle,tiktok_handle,fb_page_url,yt_channel_id,google_place_id,ra_company_slug,active');
  const conc: Profile[] = compsRaw.filter((c) => c.active).map((c) => ({
    id: c.id, handle: c.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    extra: { ig_handle: c.ig_handle, tiktok_handle: c.tiktok_handle, fb_page_url: c.fb_page_url, yt_channel_id: c.yt_channel_id, google_place_id: c.google_place_id, ra_company_slug: c.ra_company_slug },
  }));
  const r1 = await setupFor('conc', conc, ACTORS_CONC, WURL_CONC, ex);
  console.log(`  → ${r1.tasks} task(s) upserted, ${r1.skipped} skipped (sem handle do canal)`);

  let r2 = { tasks: 0, skipped: 0 };
  let batCount = 0;
  if (HAS_BAT && SB_BAT) {
    console.log('\n== Batalhão ==');
    const refRaw = await fetchProfiles(SB_BAT, 'reference_profiles', 'username,platform,is_active');
    const usernames = Array.from(new Set(refRaw.filter((r) => r.is_active).map((r) => r.username))).filter(Boolean);
    const bat: Profile[] = usernames.map((u) => ({ id: u, handle: u }));
    batCount = bat.length;
    r2 = await setupFor('bat', bat, ACTORS_BAT, WURL_BAT, ex);
    console.log(`  → ${r2.tasks} task(s) upserted, ${r2.skipped} skipped`);
  } else {
    console.log('\n== Batalhão == (SKIP — vars SUPABASE_URL_BATALHAO / WEBHOOK_URL_BATALHAO não setadas)');
  }

  console.log('\n=== TOTAL ===');
  console.log(`  Concorrentes: ${r1.tasks} tasks (${conc.length} perfis × até ${ACTORS_CONC.length} canais)`);
  if (HAS_BAT) console.log(`  Batalhão: ${r2.tasks} tasks (${batCount} perfis × ${ACTORS_BAT.length} canais)`);
  console.log(`  Webhooks apontando p/ Concorrentes: ${WURL_CONC}`);
  if (HAS_BAT) console.log(`  Webhooks apontando p/ Batalhão:    ${WURL_BAT}`);
  if (DRY) console.log('\n(DRY_RUN — nada foi gravado.)');
})().catch((e) => { console.error('FALHA:', e.message); process.exit(1); });
