import Axios from 'axios';
import env from '../util/env';
import logger from '../util/logger';
import { SerializdSeries } from '../scraper-tv';
import Bluebird from 'bluebird';

/** A season entry as returned by Sonarr's series lookup / series objects. */
interface SonarrSeason {
    seasonNumber: number;
    monitored: boolean;
    [key: string]: unknown;
}

/** Full series object from Sonarr's lookup endpoint, used as the add payload base. */
interface SonarrLookupResult {
    title: string;
    tvdbId: number;
    year?: number;
    seasons?: SonarrSeason[];
    [key: string]: unknown;
}

const DEFAULT_TAG_NAME = 'serializd';

// SONARR_API_URL/KEY are optional at the env level (the Letterboxd → Radarr
// pipeline can run standalone). Fall back to empty strings here; this module's
// functions are only ever called when the Serializd → Sonarr pipeline is
// enabled (see isSonarrEnabled() in util/env).
const axios = Axios.create({
    baseURL: env.SONARR_API_URL ?? '',
    headers: {
        'X-Api-Key': env.SONARR_API_KEY ?? ''
    }
});

export async function getQualityProfileId(profileName: string): Promise<number | null> {
    try {
        logger.debug(`Getting Sonarr quality profile ID for: ${profileName}`);

        const response = await axios.get('/api/v3/qualityprofile');
        const profiles = response.data;

        const profile = profiles.find((p: any) => p.name === profileName);
        if (profile) {
            logger.debug(`Found Sonarr quality profile: ${profileName} (ID: ${profile.id})`);
            return profile.id;
        } else {
            logger.error(`Sonarr quality profile not found: ${profileName}`);
            logger.debug('Available Sonarr profiles:', profiles.map((p: any) => p.name));
            return null;
        }
    } catch (error) {
        logger.error('Error getting Sonarr quality profiles:', error);
        return null;
    }
}

export async function getRootFolder(): Promise<string | null> {
    try {
        const response = await axios.get('/api/v3/rootfolder');
        const rootFolders = response.data;

        if (rootFolders.length > 0) {
            const rootFolder = rootFolders[0].path;
            logger.debug(`Using Sonarr root folder: ${rootFolder}`);
            return rootFolder;
        } else {
            logger.error('No root folders found in Sonarr');
            return null;
        }
    } catch (error) {
        logger.error('Error getting Sonarr root folders:', error);
        return null;
    }
}

export async function getRootFolderById(id: string) {
    try {
        const response = await axios.get(`/api/v3/rootfolder/${id}`);
        const { data } = response;
        if (data) {
            return data.path;
        } else {
            return null;
        }
    } catch (e) {
        logger.error(`Error getting Sonarr root folder by id: ${id}`);
        return null;
    }
}

export async function getOrCreateTag(tagName: string): Promise<number | null> {
    try {
        logger.debug(`Getting or creating Sonarr tag: ${tagName}`);

        const response = await axios.get('/api/v3/tag');
        const tags = response.data;

        const existingTag = tags.find((tag: any) => tag.label === tagName);
        if (existingTag) {
            logger.debug(`Sonarr tag already exists: ${tagName} (ID: ${existingTag.id})`);
            return existingTag.id;
        }

        logger.debug(`Creating new Sonarr tag: ${tagName}`);
        const createResponse = await axios.post('/api/v3/tag', {
            label: tagName
        });

        logger.info(`Created Sonarr tag: ${tagName} (ID: ${createResponse.data.id})`);
        return createResponse.data.id;
    } catch (error) {
        logger.error(`Error getting or creating Sonarr tag ${tagName}:`, error);
        return null;
    }
}

function parseConfiguredTags(): string[] {
    const tags = [DEFAULT_TAG_NAME];

    if (env.SONARR_TAGS) {
        const userTags = env.SONARR_TAGS
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
        tags.push(...userTags);
    }

    return [...new Set(tags)];
}

export async function getAllRequiredTagIds(): Promise<number[]> {
    const tagNames = parseConfiguredTags();
    const tagIdPromises = tagNames.map(tagName => getOrCreateTag(tagName));
    const tagIdsRaw = await Promise.all(tagIdPromises);
    const tagIds = tagIdsRaw.filter((tagId): tagId is number => tagId !== null);

    tagNames.forEach((tagName, index) => {
        if (tagIdsRaw[index] === null) {
            logger.warn(`Failed to create or retrieve Sonarr tag: ${tagName}`);
        }
    });

    return tagIds;
}

/**
 * Resolve the tag names in EXCLUDE_TAGS to their Sonarr tag IDs.
 * Only looks up existing tags (does NOT create them): a tag that doesn't exist
 * in Sonarr can't be on any series, so it's simply ignored.
 */
export async function getExcludedTagIds(): Promise<number[]> {
    if (!env.EXCLUDE_TAGS) return [];

    const names = env.EXCLUDE_TAGS
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0);

    if (names.length === 0) return [];

    try {
        const response = await axios.get('/api/v3/tag');
        const tags = response.data as Array<{ id: number; label: string }>;
        const ids = tags
            .filter(tag => names.includes(String(tag.label).toLowerCase()))
            .map(tag => tag.id);

        const foundLabels = tags
            .filter(tag => names.includes(String(tag.label).toLowerCase()))
            .map(tag => String(tag.label).toLowerCase());
        const missing = names.filter(n => !foundLabels.includes(n));
        if (missing.length > 0) {
            logger.debug(`Exclude tags not found in Sonarr (ignored): ${missing.join(', ')}`);
        }

        return ids;
    } catch (error) {
        logger.error('Error resolving Sonarr exclude tags:', error);
        return [];
    }
}

/**
 * Parse the SONARR_MONITOR_SEASONS env var into a list of season numbers.
 * These act as a global default; a series that pins specific seasons via
 * Serializd overrides this.
 */
export function getGlobalMonitorSeasons(): number[] {
    if (!env.SONARR_MONITOR_SEASONS) return [];
    return env.SONARR_MONITOR_SEASONS
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isInteger(n));
}

export async function upsertSeries(series: SerializdSeries[]): Promise<void> {
    if (!env.SONARR_QUALITY_PROFILE) {
        throw new Error('SONARR_QUALITY_PROFILE is not configured.');
    }

    const qualityProfileId = await getQualityProfileId(env.SONARR_QUALITY_PROFILE);

    if (!qualityProfileId) {
        throw new Error('Could not get Sonarr quality profile ID.');
    }

    const rootFolderPath = !env.SONARR_ROOT_FOLDER_ID ? await getRootFolder() : await getRootFolderById(env.SONARR_ROOT_FOLDER_ID);

    if (!rootFolderPath) {
        throw new Error('Could not get Sonarr root folder');
    }

    const tagIds = await getAllRequiredTagIds();
    const globalSeasons = getGlobalMonitorSeasons();

    await Bluebird.map(series, s => {
        return addSeries(s, qualityProfileId, rootFolderPath, tagIds, globalSeasons);
    });
}

/**
 * Look up a series in Sonarr by TMDB id and add it. Sonarr keys series on TVDB,
 * but its lookup endpoint accepts a `tmdb:{id}` term and returns the full series
 * object (including tvdbId), which we POST back to add.
 */
export async function addSeries(
    series: SerializdSeries,
    qualityProfileId: number,
    rootFolderPath: string,
    tagIds: number[],
    globalMonitorSeasons: number[] = []
): Promise<void> {
    try {
        logger.debug(`Adding series to Sonarr: ${series.name}`);

        if (!series.tmdbId) {
            logger.info(`Could not add series ${series.name} because no TMDB id was found.`);
            return;
        }

        const lookupResponse = await axios.get('/api/v3/series/lookup', {
            params: { term: `tmdb:${series.tmdbId}` }
        });

        const results: SonarrLookupResult[] = lookupResponse.data;
        const found = Array.isArray(results) ? results[0] : undefined;
        if (!found) {
            logger.warn(`No Sonarr lookup result for series ${series.name} (TMDB: ${series.tmdbId}).`);
            return;
        }

        // Decide which seasons to monitor: a series that pins specific seasons
        // via Serializd wins; otherwise fall back to the global default; an
        // empty result means "monitor all seasons".
        const seasonsToMonitor = series.seasons.length > 0 ? series.seasons : globalMonitorSeasons;
        const seasons = (found.seasons ?? []).map(s => ({
            ...s,
            monitored: seasonsToMonitor.length === 0 || seasonsToMonitor.includes(s.seasonNumber),
        }));

        const payload = {
            ...found,
            qualityProfileId,
            rootFolderPath,
            monitored: !env.SONARR_ADD_UNMONITORED,
            tags: tagIds,
            seasons,
            addOptions: {
                searchForMissingEpisodes: true
            }
        };

        if (env.DRY_RUN) {
            const scope = seasonsToMonitor.length === 0 ? 'all seasons' : `seasons ${seasonsToMonitor.join(', ')}`;
            logger.info(`[DRY RUN] Would add series to Sonarr: ${found.title} (TVDB: ${found.tvdbId}) [${scope}]`);
            return;
        }

        const response = await axios.post('/api/v3/series', payload);

        logger.info(`Successfully added series: ${found.title}`, response.data);
        return response.data;
    } catch (e: any) {
        const errorData = JSON.stringify(e.response?.data ?? '');
        if (e.response?.status === 400 && errorData.includes('already been added')) {
            if (env.UPDATE_EXISTING_TAGS) {
                logger.debug(`Series ${series.name} already exists in Sonarr, updating tags`);
                await ensureSeriesTags(series, tagIds);
            } else {
                logger.debug(`Series ${series.name} already exists in Sonarr, skipping`);
            }
            return;
        }
        logger.error(`Error adding series ${series.name} (TMDB: ${series.tmdbId}):`, e);
    }
}

/**
 * For series that already exist in Sonarr, ensure our tags are applied.
 * Fetches the existing series by TMDB ID, merges the required tags, and
 * saves if any were missing.
 */
async function ensureSeriesTags(series: SerializdSeries, requiredTagIds: number[]): Promise<void> {
    if (!series.tmdbId) return;

    try {
        const response = await axios.get('/api/v3/series', {
            params: { tmdbId: series.tmdbId }
        });

        const matches = response.data;
        if (!Array.isArray(matches) || matches.length === 0) {
            logger.debug(`Could not find existing series ${series.name} in Sonarr for tag update`);
            return;
        }

        const existing = matches[0];
        const currentTags: number[] = existing.tags || [];
        const missingTags = requiredTagIds.filter(tid => !currentTags.includes(tid));

        if (missingTags.length === 0) {
            logger.debug(`Series ${series.name} already has all required tags`);
            return;
        }

        const updatedTags = [...new Set([...currentTags, ...requiredTagIds])];

        if (env.DRY_RUN) {
            logger.info(`[DRY RUN] Would update tags for existing series: ${series.name} (adding tags: ${missingTags.join(', ')})`);
            return;
        }

        await axios.put(`/api/v3/series/${existing.id}`, {
            ...existing,
            tags: updatedTags,
        });

        logger.info(`Updated tags for existing series: ${series.name} (added tags: ${missingTags.join(', ')})`);
    } catch (error) {
        logger.error(`Error updating tags for ${series.name}:`, error);
    }
}


// ── Sync-mode helpers (bidirectional sync: add + remove) ──

export interface SonarrExistingSeries {
    id: number;
    title: string;
    tmdbId: number;
    tags: number[];
}

/**
 * Get all series currently in Sonarr that carry ALL of the given tag IDs.
 */
export async function getSeriesByTagIds(tagIds: number[]): Promise<SonarrExistingSeries[]> {
    try {
        const response = await axios.get('/api/v3/series');
        const allSeries: SonarrExistingSeries[] = response.data;
        return allSeries.filter(s =>
            tagIds.every(tid => s.tags.includes(tid))
        );
    } catch (error) {
        logger.error('Error fetching series from Sonarr:', error);
        return [];
    }
}

/**
 * Delete a series from Sonarr by its Sonarr internal ID.
 * Note: Sonarr uses `addImportListExclusion` (Radarr uses `addImportExclusion`).
 */
export async function deleteSeries(
    sonarrId: number,
    { deleteFiles = true, addImportExclusion = false }: { deleteFiles?: boolean; addImportExclusion?: boolean } = {}
): Promise<void> {
    const params = new URLSearchParams({
        deleteFiles: String(deleteFiles),
        addImportListExclusion: String(addImportExclusion),
    });
    await axios.delete(`/api/v3/series/${sonarrId}?${params.toString()}`);
}

/**
 * Remove the given tag IDs from a series (without deleting the series).
 * Used when a series leaves this instance's list but is still protected by
 * another instance's tag: we strip only this instance's tags, ending its
 * membership here while leaving the series (and its other tags) intact.
 */
export async function removeTagsFromSeries(series: SonarrExistingSeries, tagIdsToRemove: number[]): Promise<void> {
    try {
        const response = await axios.get(`/api/v3/series/${series.id}`);
        const full = response.data;
        const newTags: number[] = (full.tags || []).filter((tid: number) => !tagIdsToRemove.includes(tid));

        await axios.put(`/api/v3/series/${series.id}`, {
            ...full,
            tags: newTags,
        });
    } catch (error) {
        logger.error(`Error removing tags from "${series.title}" (ID: ${series.id}):`, error);
        throw error;
    }
}
