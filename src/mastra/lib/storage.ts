/**
 * Storage do estado interno do Mastra (mastra_*).
 * - Produção: @mastra/pg (PostgresStore) se DATABASE_URL estiver definido.
 * - Dev: LibSQL (arquivo local), sem precisar da connection string do Postgres.
 */
import { LibSQLStore } from '@mastra/libsql';
import { PostgresStore } from '@mastra/pg';

export function makeStorage() {
  const url = process.env.DATABASE_URL;
  if (url) {
    return new PostgresStore({ id: 'mastra-pg', connectionString: url });
  }
  // Dev fallback: in-memory (sem arquivo) — evita problemas de cwd no `mastra dev`/build.
  // Estado não persiste entre reinícios; em produção use DATABASE_URL (@mastra/pg).
  return new LibSQLStore({ id: 'mastra-storage', url: ':memory:' });
}
