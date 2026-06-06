/**
 * Ponte Silver → analysis: lê as tabelas Silver de um concorrente e monta os WorkItem[]
 * que o workflow `analysis` consome (Camadas 1+2). Deduplica contra `post_analysis`
 * (chave channel+source_id), então só itens AINDA NÃO analisados são retornados.
 */
import { supabase } from './supabase';
import type { Channel, WorkItem } from '../schemas/common';

const numify = (o: Record<string, unknown>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
};

interface SilverSource {
  table: string;
  channel: Channel;
  key: string; // coluna de id natural
  postedAt: string; // coluna de data (para ordenar e mapear posted_at)
  media?: string; // coluna da imagem/capa (analisada visualmente)
  video?: string | ((r: any) => string | null); // coluna OU derivação da URL do vídeo
  text: (r: any) => string | null;
  metrics: (r: any) => Record<string, number>;
}

const join = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(' — ') || null;

const SOURCES: SilverSource[] = [
  { table: 'ig_posts', channel: 'instagram', key: 'post_short_code', postedAt: 'posted_at', media: 'media_url', video: 'video_url',
    text: (r) => r.caption ?? null, metrics: (r) => numify({ likes: r.likes, comments: r.comments_count, views: r.video_views }) },
  { table: 'tiktok_videos', channel: 'tiktok', key: 'video_id', postedAt: 'posted_at', media: 'cover_url', video: 'video_url',
    text: (r) => r.caption ?? null, metrics: (r) => numify({ views: r.play_count, likes: r.digg, comments: r.comments, shares: r.shares }) },
  // yt_videos não tem coluna de arquivo de vídeo; o Gemini assiste pela watch-URL (nativa),
  // derivada do video_id. `subtitles_text` (legendas) entra no texto como sinal extra.
  { table: 'yt_videos', channel: 'youtube', key: 'video_id', postedAt: 'uploaded_at', media: 'thumbnail_url',
    video: (r) => (r.video_id ? `https://www.youtube.com/watch?v=${r.video_id}` : null),
    text: (r) => join(r.title, r.description, r.subtitles_text), metrics: (r) => numify({ views: r.views, likes: r.likes, comments: r.comments }) },
  { table: 'fb_posts', channel: 'facebook', key: 'post_id', postedAt: 'posted_at', media: 'media_url', video: 'video_url',
    text: (r) => r.text ?? null, metrics: (r) => numify({ likes: r.reactions_like, comments: r.comments, shares: r.shares, views: r.video_views }) },
  { table: 'linkedin_posts', channel: 'linkedin', key: 'post_id', postedAt: 'posted_at', media: 'media_url',
    text: (r) => r.text ?? null, metrics: (r) => numify({ likes: r.likes, comments: r.comments_count, shares: r.shares }) },
  { table: 'meta_ads', channel: 'meta_ads', key: 'ad_archive_id', postedAt: 'start_date', media: 'creative_url', video: 'video_url',
    text: (r) => join(r.hook, r.copy), metrics: (r) => numify({ page_likes: r.page_likes, days_running: r.days_running }) },
  { table: 'google_ads', channel: 'google_ads', key: 'creative_id', postedAt: 'first_seen', media: 'image_url',
    text: (r) => join(r.headline, r.description), metrics: (r) => numify({ days_served: r.days_served }) },
  { table: 'google_reviews', channel: 'google_reviews', key: 'review_id', postedAt: 'posted_at',
    text: (r) => r.text ?? null, metrics: (r) => numify({ rating: r.rating }) },
  { table: 'google_qa', channel: 'google_reviews', key: 'id', postedAt: 'posted_at',
    text: (r) => join(r.question, r.answer_text), metrics: () => ({}) },
  { table: 'ra_complaints', channel: 'reclame_aqui', key: 'ra_id', postedAt: 'posted_at',
    text: (r) => join(r.title, r.body), metrics: (r) => numify({ rating: r.rating }) },
];

/** Constrói 1 WorkItem a partir de uma linha Silver + config da fonte (null se sem chave). */
function toWorkItem(competitorId: string, s: SilverSource, r: any): WorkItem | null {
  const sid = r[s.key] != null ? String(r[s.key]) : null;
  if (!sid) return null;
  return {
    competitor_id: competitorId,
    channel: s.channel,
    source_table: s.table,
    source_id: sid,
    posted_at: r[s.postedAt] ?? null,
    text: s.text(r),
    media_url: s.media ? (r[s.media] ?? null) : null,
    video_url: typeof s.video === 'function' ? s.video(r) : s.video ? (r[s.video] ?? null) : null,
    metrics: s.metrics(r),
  };
}

/**
 * Reconstrói WorkItems para referências específicas (source_table + source_id), SEM dedup e
 * SEM cap — usado pela re-análise de vídeos (reprocessar exatamente os itens-alvo).
 */
export async function fetchWorkItemsByRefs(
  competitorId: string,
  refs: { source_table: string; source_id: string }[],
): Promise<WorkItem[]> {
  const sb = supabase();
  const byTable = new Map<string, string[]>();
  for (const { source_table, source_id } of refs) {
    byTable.set(source_table, [...(byTable.get(source_table) ?? []), source_id]);
  }
  const items: WorkItem[] = [];
  for (const [table, ids] of byTable) {
    const s = SOURCES.find((x) => x.table === table);
    if (!s) continue;
    const { data, error } = await sb.from(table).select('*').eq('competitor_id', competitorId).in(s.key, ids);
    if (error) {
      console.warn(`[silver] ${table}: ${error.message}`);
      continue;
    }
    for (const r of (data ?? []) as any[]) {
      const it = toWorkItem(competitorId, s, r);
      if (it) items.push(it);
    }
  }
  return items;
}

/**
 * TODOS os itens com vídeo (video_url) de um concorrente — reels, tiktok, youtube, etc. —
 * SEM cap, pulando os que JÁ foram analisados pelo Gemini. Usado para garantir que todo
 * vídeo seja assistido (resgata reels que o organizer havia classificado como image e o
 * excedente além do cap de 50/tabela).
 */
export async function fetchVideoWorkItems(competitorId: string): Promise<WorkItem[]> {
  const sb = supabase();
  const { data: done } = await sb
    .from('post_analysis')
    .select('channel,source_id')
    .eq('competitor_id', competitorId)
    .ilike('specialist_used', '%gemini%');
  const gem = new Set((done ?? []).map((d: any) => `${d.channel}::${d.source_id}`));

  const items: WorkItem[] = [];
  for (const s of SOURCES) {
    if (!s.video) continue; // só fontes que têm vídeo
    const { data, error } = await sb.from(s.table).select('*').eq('competitor_id', competitorId);
    if (error) {
      console.warn(`[silver] ${s.table}: ${error.message}`);
      continue;
    }
    for (const r of (data ?? []) as any[]) {
      const it = toWorkItem(competitorId, s, r);
      if (!it || !it.video_url) continue; // precisa ter vídeo de fato
      if (gem.has(`${it.channel}::${it.source_id}`)) continue; // já assistido pelo Gemini
      items.push(it);
    }
  }
  return items;
}

/** Monta WorkItems não-analisados de um concorrente a partir das tabelas Silver. */
export async function fetchWorkItems(competitorId: string, limitPerTable = 50): Promise<WorkItem[]> {
  const sb = supabase();

  const { data: done } = await sb.from('post_analysis').select('channel,source_id').eq('competitor_id', competitorId);
  const seen = new Set((done ?? []).map((d: any) => `${d.channel}::${d.source_id}`));

  const items: WorkItem[] = [];
  for (const s of SOURCES) {
    const { data, error } = await sb
      .from(s.table)
      .select('*')
      .eq('competitor_id', competitorId)
      .order(s.postedAt, { ascending: false })
      .limit(limitPerTable);
    if (error) {
      console.warn(`[silver] ${s.table}: ${error.message}`);
      continue;
    }
    for (const r of (data ?? []) as any[]) {
      const it = toWorkItem(competitorId, s, r);
      if (!it) continue;
      const dkey = `${it.channel}::${it.source_id}`;
      if (seen.has(dkey)) continue;
      seen.add(dkey);
      items.push(it);
    }
  }
  return items;
}
