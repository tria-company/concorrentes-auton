/**
 * Instância central do Mastra — registra os 25 agentes (1 organizer + 10 especialistas
 * + 9 sintetizadores + 1 consolidador + 4 geradores), os workflows do pipeline e as rotas
 * HTTP (webhook Apify + cron dispatch).
 *
 * Storage: PostgresStore (Supabase) se DATABASE_URL estiver definido; senão LibSQL (dev).
 * As 22 tabelas de negócio são acessadas via supabase-js (ver lib/supabase.ts).
 */
import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { VercelDeployer } from '@mastra/deployer-vercel';

import { makeStorage } from './lib/storage';
import { apiRoutes } from './server/routes';
import { threatBriefScorer } from './scorers/threat-brief-scorer';
import { agentQualityScorer } from './scorers/agent-quality';

import { organizer } from './agents/organizer';
import { specialistsById } from './agents/specialists';
import { synthesizersById } from './agents/synthesizers';
import { consolidator } from './agents/consolidator';
import { generatorsById } from './agents/generators';

import { ingestionWorkflow } from './workflows/ingestion';
import { analysisWorkflow } from './workflows/analysis';
import { synthesisConsolidationWorkflow } from './workflows/synthesis-consolidation';
import { radarWorkflow } from './workflows/journeys/radar';
import { referenciasWorkflow } from './workflows/journeys/referencias';
import { insightsWorkflow } from './workflows/journeys/insights';
import { captacaoWorkflow } from './workflows/journeys/captacao';

export const mastra = new Mastra({
  agents: {
    'agt-organizer': organizer,
    ...specialistsById,
    ...synthesizersById,
    'agt-consolidator': consolidator,
    ...generatorsById,
  },
  workflows: {
    ingestion: ingestionWorkflow,
    analysis: analysisWorkflow,
    'synthesis-consolidation': synthesisConsolidationWorkflow,
    'journey-radar': radarWorkflow,
    'journey-referencias': referenciasWorkflow,
    'journey-insights': insightsWorkflow,
    'journey-captacao': captacaoWorkflow,
  },
  scorers: { 'threat-brief-qa': threatBriefScorer, 'agent-quality': agentQualityScorer },
  storage: makeStorage(),
  logger: new PinoLogger({ name: 'painel-concorrentes', level: 'info' }),
  server: { apiRoutes },
  // Deployer só para Vercel (DEPLOY_TARGET=vercel). Na VPS (long-running), sem deployer →
  // `mastra build` gera um servidor Node padrão, rodável com `node .mastra/output/index.mjs`.
  ...(process.env.DEPLOY_TARGET === 'vercel' ? { deployer: new VercelDeployer() } : {}),
});
