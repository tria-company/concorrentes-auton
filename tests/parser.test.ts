/**
 * Regressão dos parsers Bronze→Silver — fixtures com o SHAPE REAL dos actors Apify,
 * confirmado em 2026-05-27 contra datasets reais da conta (ver scripts/validate-parsers-live.ts).
 * Trava os mapeamentos validados (especialmente os bugs corrigidos: google_ads `adFormat`/
 * `approxDaysShown` e o achatamento do wrapper `{results:[]}` do facebook-ads-scraper).
 */
import { describe, it, expect } from 'vitest';
import { parsePayload } from '../src/mastra/lib/parser';

const CID = '00000000-0000-0000-0000-000000000000';

describe('parsers Bronze→Silver (shapes reais Apify)', () => {
  it('instagram (apify/instagram-scraper): mapeia shortCode/likesCount/etc → ig_posts', () => {
    const ins = parsePayload('instagram', [
      { shortCode: 'ABC123', type: 'Image', caption: 'oi', hashtags: ['#x'], mentions: [],
        likesCount: 10, commentsCount: 2, videoViewCount: 0, timestamp: '2026-05-01T00:00:00Z',
        displayUrl: 'http://img', videoUrl: null, videoDuration: null },
    ], CID);
    expect(ins?.table).toBe('ig_posts');
    expect(ins?.key).toBe('post_short_code');
    const row = ins!.rows[0];
    expect(row.post_short_code).toBe('ABC123');
    expect(row.likes).toBe(10);
    expect(row.comments_count).toBe(2);
    expect(row.competitor_id).toBe(CID);
  });

  it('facebook (apify/facebook-posts-scraper): imagem vem de media[*].image.uri (não do permalink)', () => {
    const ins = parsePayload('facebook', [
      { postId: 'p1', text: 'oi', likes: 5, shares: 1, time: '2026-05-01T00:00:00Z',
        // media[0] é só o permalink do post; a imagem real está em media[1].image.uri
        media: [
          { url: 'https://facebook.com/permalink.php?story_fbid=x', mediaset_token: 't' },
          { image: { uri: 'https://scontent.fbcdn.net/v/img.jpg' }, thumbnail: 'https://scontent.fbcdn.net/v/thumb.jpg' },
        ],
        url: 'http://post', pageName: 'Acme' },
    ], CID);
    expect(ins?.table).toBe('fb_posts');
    const row = ins!.rows[0];
    expect(row.post_id).toBe('p1');
    expect(row.reactions_like).toBe(5);
    expect(row.media_url).toBe('https://scontent.fbcdn.net/v/img.jpg'); // ← imagem real, não o permalink
    expect(row.page_name).toBe('Acme');
  });

  it('google_ads (solidcode): adFormat→format e approxDaysShown→days_served (bug corrigido)', () => {
    const ins = parsePayload('google_ads', [
      { creativeId: 'c1', advertiserId: 'a1', advertiserName: 'Acme', adFormat: 'video',
        approxDaysShown: 42, firstShown: '2026-04-01', lastShown: '2026-05-01',
        imageUrl: 'http://i', adUrl: 'http://ad' },
    ], CID);
    expect(ins?.table).toBe('google_ads');
    const row = ins!.rows[0];
    expect(row.creative_id).toBe('c1');
    expect(row.format).toBe('video'); // ← antes vinha null (lia p.format)
    expect(row.days_served).toBe(42); // ← antes vinha null (lia p.daysServed)
    expect(row.ad_url).toBe('http://ad');
  });

  it('meta_ads (apify/facebook-ads-scraper): achata wrapper {results:[...]} (bug corrigido)', () => {
    const ins = parsePayload('meta_ads', [
      { inputUrl: 'http://x', totalCount: 2, results: [
        { adArchiveId: 'ad1', snapshot: { body: { text: 'copy1' } } },
        { adArchiveId: 'ad2', snapshot: { body: { text: 'copy2' } } },
      ] },
    ], CID);
    expect(ins?.table).toBe('meta_ads');
    expect(ins!.rows.length).toBe(2); // ← antes vinha 0 (não desempacotava results)
    expect(ins!.rows[0].ad_archive_id).toBe('ad1');
    expect(ins!.rows[0].copy).toBe('copy1');
  });

  it('meta_ads também aceita anúncio direto (sem wrapper results)', () => {
    const ins = parsePayload('meta_ads', [
      { adArchiveId: 'adX', snapshot: { body: { text: 'direto' } } },
    ], CID);
    expect(ins!.rows.length).toBe(1);
    expect(ins!.rows[0].ad_archive_id).toBe('adX');
  });

  it('instagram: extrai video_url do reel (vai pro Gemini)', () => {
    const ins = parsePayload('instagram', [
      { shortCode: 'R1', type: 'Video', videoUrl: 'https://cdn/reel.mp4', displayUrl: 'https://cdn/cover.jpg', timestamp: '2026-05-01' },
    ], CID);
    expect(ins!.rows[0].video_url).toBe('https://cdn/reel.mp4');
    expect(ins!.rows[0].media_url).toBe('https://cdn/cover.jpg');
  });

  it('tiktok: id/stats aninhados → tiktok_videos', () => {
    const ins = parsePayload('tiktok', [
      { id: 'tt1', text: 'dança', createTimeISO: '2026-05-01T00:00:00Z', webVideoUrl: 'https://tt/v',
        stats: { playCount: 1000, diggCount: 50, commentCount: 4, shareCount: 2 },
        videoMeta: { duration: 15, coverUrl: 'https://tt/cover.jpg' }, musicMeta: { musicName: 'som x' } },
    ], CID);
    expect(ins?.table).toBe('tiktok_videos');
    const r = ins!.rows[0];
    expect(r.video_id).toBe('tt1');
    expect(r.play_count).toBe(1000);
    expect(r.digg).toBe(50);
    expect(r.duration_sec).toBe(15);
    expect(r.cover_url).toBe('https://tt/cover.jpg');
  });

  it('youtube: mapeia campos básicos → yt_videos', () => {
    const ins = parsePayload('youtube', [
      { id: 'yt1', title: 'Tutorial', description: 'desc', viewCount: 5000, likes: 100,
        commentsCount: 10, duration: 600, date: '2026-05-01', isShort: false, thumbnailUrl: 'https://yt/t.jpg' },
    ], CID);
    expect(ins?.table).toBe('yt_videos');
    const r = ins!.rows[0];
    expect(r.video_id).toBe('yt1');
    expect(r.title).toBe('Tutorial');
    expect(r.views).toBe(5000);
    expect(r.is_short).toBe(false);
    expect(r.thumbnail_url).toBe('https://yt/t.jpg');
  });

  it('google_reviews: stars→rating, dedup por review_id', () => {
    const ins = parsePayload('google_reviews', [
      { reviewId: 'gr1', stars: 5, text: 'ótimo', name: 'Ana', publishedAtDate: '2026-05-01' },
    ], CID);
    expect(ins?.table).toBe('google_reviews');
    expect(ins?.key).toBe('review_id');
    const r = ins!.rows[0];
    expect(r.review_id).toBe('gr1');
    expect(r.rating).toBe(5);
    expect(r.reviewer_name).toBe('Ana');
  });

  it('google_qa: chave natural é a pergunta', () => {
    const ins = parsePayload('google_qa', [
      { question: 'Tem estacionamento?', answer: 'Sim', date: '2026-05-01' },
    ], CID);
    expect(ins?.key).toBe('question');
    const r = ins!.rows[0];
    expect(r.question).toBe('Tem estacionamento?');
    expect(r.answer_text).toBe('Sim');
    expect(r.has_answer).toBe(true);
  });

  it('reclame_aqui: aliases ra/reclameaqui → ra_complaints', () => {
    const ins = parsePayload('ra', [
      { id: 'ra1', consumerName: 'João', title: 'Problema', description: 'corpo', status: 'respondida',
        created: '2026-05-01', solved: true },
    ], CID);
    expect(ins?.table).toBe('ra_complaints');
    const r = ins!.rows[0];
    expect(r.ra_id).toBe('ra1');
    expect(r.reclamante).toBe('João');
    expect(r.is_resolved).toBe(true);
  });

  it('linkedin: numLikes/numComments → linkedin_posts', () => {
    const ins = parsePayload('linkedin', [
      { id: 'li1', text: 'post', numLikes: 30, numComments: 5, numShares: 2, postedAtISO: '2026-05-01' },
    ], CID);
    expect(ins?.table).toBe('linkedin_posts');
    const r = ins!.rows[0];
    expect(r.post_id).toBe('li1');
    expect(r.likes).toBe(30);
    expect(r.comments_count).toBe(5);
  });

  it('itens sem chave natural são descartados', () => {
    const ins = parsePayload('instagram', [{ caption: 'sem shortCode' }, { shortCode: 'OK1' }], CID);
    expect(ins!.rows.length).toBe(1);
    expect(ins!.rows[0].post_short_code).toBe('OK1');
  });

  it('source desconhecido → null', () => {
    expect(parsePayload('myspace', [{}], CID)).toBeNull();
  });
});
