/**
 * Client Supabase (service_role) para as 22 tabelas de negócio.
 * O service_role ignora RLS — usar SOMENTE no backend, nunca expor ao cliente.
 * O estado interno do Mastra (mastra_*) vai por outro storage (ver mastra/index.ts).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
