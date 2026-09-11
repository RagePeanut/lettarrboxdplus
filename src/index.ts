require('dotenv').config();


import env from './util/env';
import logger from './util/logger';
import { fetchMoviesFromUrl } from './scraper';
import { upsertMovies, getAllRequiredTagIds, getMoviesByTagIds, deleteMovie } from './api/radarr';

function startScheduledMonitoring(): void {
  const intervalMs = env.CHECK_INTERVAL_MINUTES * 60 * 1000;

  logger.info(`Starting scheduled monitoring. Will check every ${env.CHECK_INTERVAL_MINUTES} minutes.`);
  if (env.SYNC_MODE === 'sync') {
    logger.info('Sync mode enabled: movies removed from the Letterboxd list will be removed from Radarr.');
  }

  // Run immediately on startup
  run();

  // Then run on interval
  setInterval(async () => {
    await run();
  }, intervalMs);
}

async function run() {
  const movies = await fetchMoviesFromUrl(env.LETTERBOXD_URL);
  await upsertMovies(movies);

  if (env.SYNC_MODE === 'sync') {
    await syncRemovals(movies.map(m => m.tmdbId ? parseInt(m.tmdbId) : null).filter((id): id is number => id !== null));
  }
}

/**
 * Remove movies from Radarr that are tagged with our tags but no longer on the
 * Letterboxd list. This makes the Letterboxd list the single source of truth.
 */
async function syncRemovals(currentTmdbIds: number[]): Promise<void> {
  try {
    const tagIds = await getAllRequiredTagIds();
    if (tagIds.length === 0) {
      logger.warn('No tag IDs resolved — cannot determine which Radarr movies belong to this list. Skipping removal sync.');
      return;
    }

    const radarrMovies = await getMoviesByTagIds(tagIds);
    const currentSet = new Set(currentTmdbIds);

    // Movies in Radarr (with our tags) that are NOT on the current Letterboxd list = removed.
    const toRemove = radarrMovies.filter(m => !currentSet.has(m.tmdbId));

    if (toRemove.length === 0) {
      logger.debug('No movies to remove — Radarr and Letterboxd list are in sync.');
      return;
    }

    for (const movie of toRemove) {
      if (env.DRY_RUN) {
        logger.info(`[DRY RUN] Would remove from Radarr: "${movie.title}" (TMDB: ${movie.tmdbId}, deleteFiles=${env.DELETE_FILES}, addImportExclusion=${env.ADD_IMPORT_EXCLUSION})`);
        continue;
      }

      try {
        await deleteMovie(movie.id, {
          deleteFiles: env.DELETE_FILES,
          addImportExclusion: env.ADD_IMPORT_EXCLUSION,
        });
        logger.info(`Removed from Radarr: "${movie.title}" (TMDB: ${movie.tmdbId}, files ${env.DELETE_FILES ? 'deleted' : 'kept'})`);
      } catch (error) {
        logger.error(`Error removing "${movie.title}" (ID: ${movie.id}):`, error);
      }
    }
  } catch (error) {
    logger.error('Error during removal sync:', error);
  }
}

export async function main() {
  startScheduledMonitoring();
}

export { startScheduledMonitoring };

// Only run main if this file is executed directly
if (require.main === module) {
  main().catch(logger.error);
}
