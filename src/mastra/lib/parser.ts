/**
 * Parser Bronze→Silver (Camada 0). Registry `source → função` que extrai linhas tipadas
 * do payload Apify para a tabela Silver correta (colunas conferidas no schema real).
 *
 * Os nomes de campo do payload variam por actor; mapeamos com fallbacks dos formatos mais
 * comuns. PKs `bigint` (identity) são omitidas — o Postgres gera. A coluna `competitor_id`
 * vem do contexto do webhook. Inserts simples (idempotência por natural key é TODO).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SilverInsert {
  table: string;
  /** Coluna de chave natural (para dedup idempotente na ingestão). */
  key: string;
  rows: Record<string, unknown>[];
}
type ParserFn = (payload: unknown, competitorId: string | null) => SilverInsert | null;

/** Chave natural por tabela Silver. */
const KEYS: Record<string, string> = {
  ig_posts: 'post_short_code',
  tiktok_videos: 'video_id',
  yt_videos: 'video_id',
  fb_posts: 'post_id',
  meta_ads: 'ad_archive_id',
  google_ads: 'creative_id',
  google_reviews: 'review_id',
  google_qa: 'question',
  ra_complaints: 'ra_id',
  linkedin_posts: 'post_id',
};

const asArray = (payload: unknown): any[] => {
  if (Array.isArray(payload)) return payload as any[];
  const items = (payload as { items?: unknown })?.items;
  if (Array.isArray(items)) return items as any[];
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as any[]) : [];
};

const str = (v: any): string | null => (v == null ? null : String(v));
const num = (v: any): number | null =>
  v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const bool = (v: any): boolean | null => (v == null ? null : Boolean(v));
const arr = (v: any): any[] | null => (Array.isArray(v) ? v : null);

function build(table: string, items: any[], map: (p: any) => Record<string, unknown> | null, competitorId: string): SilverInsert {
  const rows = items.map(map).filter((r): r is Record<string, unknown> => r != null);
  rows.forEach((r) => (r.competitor_id = competitorId));
  return { table, key: KEYS[table] ?? 'id', rows };
}

const instagram: ParserFn = (payload, cid) => {
  if (!cid) return null;
  return build('ig_posts', asArray(payload), (p) => {
    const code = str(p.shortCode ?? p.shortcode ?? p.code ?? p.id);
    if (!code) return null;
    return {
      post_short_code: code,
      type: str(p.type ?? p.productType),
      caption: str(p.caption ?? p.text),
      hashtags: arr(p.hashtags),
      mentions: arr(p.mentions),
      likes: num(p.likesCount ?? p.likes),
      comments_count: num(p.commentsCount ?? p.comments),
      video_views: num(p.videoViewCount ?? p.videoPlayCount ?? p.views),
      posted_at: str(p.timestamp ?? p.takenAt),
      is_paid_partnership: bool(p.isSponsored ?? p.isPaidPartnership),
      display_url: str(p.displayUrl),
      media_url: str(p.displayUrl ?? p.url),
      video_url: str(p.videoUrl),
      video_duration_sec: num(p.videoDuration),
    };
  }, cid);
};

const tiktok: ParserFn = (payload, cid) => {
  if (!cid) return null;
  return build('tiktok_videos', asArray(payload), (p) => {
    const id = str(p.id ?? p.videoId ?? p.awemeId);
    if (!id) return null;
    const s = p.stats ?? {};
    return {
      video_id: id,
      caption: str(p.text ?? p.desc ?? p.caption),
      play_count: num(p.playCount ?? s.playCount),
      digg: num(p.diggCount ?? s.diggCount ?? p.likes),
      shares: num(p.shareCount ?? s.shareCount),
      comments: num(p.commentCount ?? s.commentCount),
      collect: num(p.collectCount ?? s.collectCount),
      music_name: str(p.musicMeta?.musicName ?? p.music?.title),
      music_original: bool(p.musicMeta?.musicOriginal),
      duration_sec: num(p.videoMeta?.duration ?? p.duration),
      posted_at: str(p.createTimeISO ?? p.createTime),
      video_url: str(p.webVideoUrl ?? p.videoUrl),
      cover_url: str(p.videoMeta?.coverUrl ?? p.covers?.[0]),
    };
  }, cid);
};

const youtube: ParserFn = (payload, cid) => {
  if (!cid) return null;
  return build('yt_videos', asArray(payload), (p) => {
    const id = str(p.id ?? p.videoId);
    if (!id) return null;
    return {
      video_id: id,
      title: str(p.title),
      description: str(p.description ?? p.text),
      views: num(p.viewCount ?? p.views),
      likes: num(p.likes ?? p.likeCount),
      comments: num(p.commentsCount ?? p.commentCount),
      duration_sec: num(p.duration),
      uploaded_at: str(p.date ?? p.uploadDate ?? p.publishedAt),
      is_short: bool(p.isShort),
      thumbnail_url: str(p.thumbnailUrl ?? p.thumbnail),
    };
  }, cid);
};

const facebook: ParserFn = (payload, cid) => {
  if (!cid) return null;
  return build('fb_posts', asArray(payload), (p) => {
    const id = str(p.postId ?? p.id);
    if (!id) return null;
    const r = p.reactions ?? {};
    // A imagem real está em media[*].image.uri / thumbnail (media[0].url costuma ser o
    // permalink do post, não a imagem). O vídeo, quando há, em media[*].video(.uri)/playable_url.
    const media = Array.isArray(p.media) ? p.media : [];
    const imgUrl = media.map((m: any) => m?.image?.uri ?? m?.thumbnail ?? m?.photo_image?.uri).find(Boolean);
    const vidUrl = media.map((m: any) => m?.video?.uri ?? m?.playable_url ?? m?.videoUrl).find(Boolean);
    return {
      post_id: id,
      text: str(p.text ?? p.message),
      reactions_like: num(p.likes ?? r.like),
      shares: num(p.shares ?? p.sharesCount),
      comments: num(p.comments ?? p.commentsCount),
      video_views: num(p.viewsCount ?? p.videoViews),
      posted_at: str(p.time ?? p.date ?? p.timestamp),
      media_url: str(imgUrl ?? p.imageUrl),
      video_url: str(vidUrl ?? p.videoUrl),
      is_video: bool(p.isVideo),
      post_url: str(p.url ?? p.postUrl),
      page_name: str(p.pageName ?? p.user?.name),
    };
  }, cid);
};

const metaAds: ParserFn = (payload, cid) => {
  if (!cid) return null;
  // O `apify/facebook-ads-scraper` agrupa os anúncios em `{ results: [...] }` por URL de
  // entrada; outros actors (ex. ads-library) retornam o anúncio direto. Achatamos os dois.
  const items = asArray(payload).flatMap((it: any) => (Array.isArray(it?.results) ? it.results : [it]));
  return build('meta_ads', items, (p) => {
    const id = str(p.adArchiveId ?? p.ad_archive_id ?? p.id);
    if (!id) return null;
    const snap = p.snapshot ?? {};
    return {
      ad_archive_id: id,
      hook: str(p.hook),
      copy: str(snap.body?.text ?? p.adText ?? p.copy ?? p.text),
      creative_url: str(snap.images?.[0]?.originalImageUrl ?? p.imageUrl ?? p.creativeUrl),
      format: str(p.displayFormat ?? p.format),
      platforms: arr(p.publisherPlatform ?? p.platforms),
      start_date: str(p.startDateFormatted ?? p.startDate),
      end_date: str(p.endDateFormatted ?? p.endDate),
      days_running: num(p.daysRunning),
      status: str(p.status ?? (p.isActive == null ? null : p.isActive ? 'active' : 'inactive')),
      video_url: str(snap.videos?.[0]?.videoHdUrl ?? p.videoUrl),
      page_likes: num(p.pageLikeCount ?? p.pageLikes),
    };
  }, cid);
};

const googleAds: ParserFn = (payload, cid) => {
  if (!cid) return null;
  return build('google_ads', asArray(payload), (p) => {
    const id = str(p.creativeId ?? p.id);
    if (!id) return null;
    return {
      creative_id: id,
      advertiser_id: str(p.advertiserId),
      advertiser_name: str(p.advertiserName),
      headline: str(p.headline ?? p.title),
      description: str(p.description ?? p.text),
      format: str(p.adFormat ?? p.format),
      regions: arr(p.regions),
      first_seen: str(p.firstSeen ?? p.firstShown),
      last_seen: str(p.lastSeen ?? p.lastShown),
      days_served: num(p.approxDaysShown ?? p.daysServed),
      cta: str(p.cta),
      landing_page: str(p.landingPage ?? p.url),
      image_url: str(p.imageUrl),
      ad_url: str(p.adUrl ?? p.url),
    };
  }, cid);
};

const googleReviews: ParserFn = (payload, cid) => {
  if (!cid) return null;
  return build('google_reviews', asArray(payload), (p) => {
    const id = str(p.reviewId ?? p.id);
    if (!id) return null;
    return {
      review_id: id,
      rating: num(p.stars ?? p.rating),
      text: str(p.text ?? p.reviewText),
      reviewer_name: str(p.name ?? p.reviewerName),
      reviewer_review_count: num(p.reviewerNumberOfReviews ?? p.reviewsCount),
      is_local_guide: bool(p.isLocalGuide),
      posted_at: str(p.publishedAtDate ?? p.publishAt ?? p.date),
      owner_response_text: str(p.responseFromOwnerText ?? p.ownerResponse?.text),
      owner_response_at: str(p.responseFromOwnerDate),
    };
  }, cid);
};

const googleQa: ParserFn = (payload, cid) => {
  if (!cid) return null;
  return build('google_qa', asArray(payload), (p) => {
    const q = str(p.question ?? p.text);
    if (!q) return null;
    return {
      question: q,
      answer_text: str(p.answer ?? p.answerText ?? p.topAnswer),
      has_answer: bool(p.answer ?? p.hasAnswer),
      posted_at: str(p.date ?? p.askDate),
    };
  }, cid);
};

const reclameAqui: ParserFn = (payload, cid) => {
  if (!cid) return null;
  return build('ra_complaints', asArray(payload), (p) => {
    const id = str(p.id ?? p.complaintId ?? p.ra_id);
    if (!id) return null;
    return {
      ra_id: id,
      reclamante: str(p.consumerName ?? p.reclamante ?? p.author),
      title: str(p.title),
      body: str(p.description ?? p.body ?? p.text),
      status: str(p.status),
      theme: str(p.theme ?? p.category),
      posted_at: str(p.created ?? p.createdAt ?? p.date),
      rating: num(p.rating ?? p.score),
      url: str(p.url),
      city: str(p.city),
      state: str(p.state),
      is_resolved: bool(p.solved ?? p.isResolved),
      would_buy_again: bool(p.wouldDoBusinessAgain),
    };
  }, cid);
};

const linkedin: ParserFn = (payload, cid) => {
  if (!cid) return null;
  return build('linkedin_posts', asArray(payload), (p) => {
    const id = str(p.id ?? p.urn ?? p.postUrl ?? p.url);
    if (!id) return null;
    return {
      post_id: id,
      text: str(p.text ?? p.commentary),
      post_type: str(p.type),
      post_url: str(p.postUrl ?? p.url),
      author_name: str(p.author?.name ?? p.authorName),
      likes: num(p.numLikes ?? p.likes),
      comments_count: num(p.numComments ?? p.comments),
      shares: num(p.numShares ?? p.shares),
      posted_at: str(p.postedAtISO ?? p.publishedAt),
    };
  }, cid);
};

/** Normaliza aliases de `source` → chave canônica. */
const ALIAS: Record<string, string> = {
  ig: 'instagram',
  insta: 'instagram',
  fb: 'facebook',
  yt: 'youtube',
  ra: 'reclame_aqui',
  reclameaqui: 'reclame_aqui',
  'meta-ads': 'meta_ads',
  metaads: 'meta_ads',
  'google-ads': 'google_ads',
  googleads: 'google_ads',
  'google-reviews': 'google_reviews',
  reviews: 'google_reviews',
  'google-qa': 'google_qa',
  qa: 'google_qa',
};

export const PARSERS: Record<string, ParserFn> = {
  instagram,
  tiktok,
  youtube,
  facebook,
  meta_ads: metaAds,
  google_ads: googleAds,
  google_reviews: googleReviews,
  google_qa: googleQa,
  reclame_aqui: reclameAqui,
  linkedin,
};

export function parsePayload(source: string, payload: unknown, competitorId: string | null): SilverInsert | null {
  const key = ALIAS[source?.toLowerCase?.() ?? ''] ?? source?.toLowerCase?.() ?? '';
  const fn = PARSERS[key];
  return fn ? fn(payload, competitorId) : null;
}
