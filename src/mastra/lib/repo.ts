/** Persistência das tabelas Gold IA (Agent Authority). UPSERTs idempotentes. */
import { supabase } from './supabase';
import type { PostAnalysisRow } from '../schemas/post-analysis';
import type { ChannelSynthesisRow } from '../schemas/channel-synthesis';
import type { ThreatBriefRow } from '../schemas/threat-brief';

export async function upsertPostAnalysis(row: PostAnalysisRow): Promise<void> {
  const { error } = await supabase()
    .from('post_analysis')
    .upsert(row, { onConflict: 'competitor_id,channel,source_id' });
  if (error) throw new Error(`post_analysis upsert: ${error.message}`);
}

export async function upsertChannelSynthesis(row: ChannelSynthesisRow): Promise<void> {
  const { error } = await supabase()
    .from('channel_synthesis')
    .upsert(row, { onConflict: 'competitor_id,channel,generated_at' });
  if (error) throw new Error(`channel_synthesis upsert: ${error.message}`);
}

export async function upsertThreatBrief(row: ThreatBriefRow): Promise<void> {
  const { error } = await supabase()
    .from('competitor_threat_brief')
    .upsert(row, { onConflict: 'competitor_id' });
  if (error) throw new Error(`competitor_threat_brief upsert: ${error.message}`);
}

/** Lê as análises de um canal para alimentar o sintetizador (Camada 3). */
export async function fetchAnalysisForChannel(
  competitorId: string,
  channel: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase()
    .from('post_analysis')
    .select('*')
    .eq('competitor_id', competitorId)
    .eq('channel', channel);
  if (error) throw new Error(`post_analysis fetch: ${error.message}`);
  return data ?? [];
}

/** Lê as sínteses de canal para alimentar o consolidador (Camada 4). */
export async function fetchChannelSyntheses(
  competitorId: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase()
    .from('channel_synthesis')
    .select('*')
    .eq('competitor_id', competitorId)
    .order('generated_at', { ascending: false });
  if (error) throw new Error(`channel_synthesis fetch: ${error.message}`);
  return data ?? [];
}
