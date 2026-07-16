import type { FastifyInstance } from 'fastify';
import type { LearningStatsDTO } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { getSettings } from '../settings.js';
import { loadLearned, resetLearnedStats } from '../learning/stats.js';

export function registerLearningRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  app.get('/learning/stats', async (): Promise<LearningStatsDTO> => {
    const settings = getSettings(db);
    const learned = loadLearned(db, settings);
    // Only surface hours with some evidence.
    const hasData = learned.hourSuccess.totalWeight > 0;
    const ranked = learned.hourSuccess.rates
      .map((rate, hour) => ({ hour, rate }))
      .filter(() => hasData)
      .sort((a, b) => b.rate - a.rate);
    return {
      enabled: learned.enabled,
      globalMultiplier: learned.multipliers.global.value,
      globalWeight: learned.multipliers.global.weight,
      bestHours: ranked.slice(0, 3),
      worstHours: ranked.slice(-3).reverse(),
      hourWeight: learned.hourSuccess.totalWeight,
    };
  });

  app.post('/learning/reset', async () => {
    resetLearnedStats(db);
    await manager.forcePlan('learning-reset');
    return { ok: true };
  });
}
