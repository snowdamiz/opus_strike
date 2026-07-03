import { Router } from 'express';
import { pregeneratedMapCatalogService } from './pregeneratedMapCatalog';
import { loggers } from '../utils/logger';

export function createMapRouter(): Router {
  const router = Router();

  router.get('/pregenerated/:mapId/manifest', async (req, res) => {
    const mapId = typeof req.params.mapId === 'string' ? req.params.mapId.trim() : '';
    if (!mapId) {
      res.status(400).json({ error: 'Missing map id' });
      return;
    }

    try {
      const { summary, artifact } = await pregeneratedMapCatalogService.loadPublicMapArtifact(mapId);
      res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
      res.json({ map: summary, artifact });
    } catch (error) {
      loggers.room.warn('Failed to serve pregenerated map artifact', {
        mapId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(404).json({ error: 'Map artifact not found' });
    }
  });

  return router;
}

