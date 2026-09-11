import Axios from 'axios';
import env from '../util/env';
import logger from '../util/logger';
import { LetterboxdMovie } from '../scraper';
import Bluebird from 'bluebird';

interface RadarrMovie {
    title: string;
    qualityProfileId: number;
    rootFolderPath: string;
    tmdbId: number;
    minimumAvailability: string;
    monitored: boolean;
    tags: number[];
    addOptions: {
        searchForMovie: boolean;
    }
}

const DEFAULT_TAG_NAME = 'letterboxd';

const axios = Axios.create({
    baseURL: env.RADARR_API_URL,
    headers: {
        'X-Api-Key': env.RADARR_API_KEY
    }
});

export async function getQualityProfileId(profileName: string): Promise<number | null> {
    try {
        logger.debug(`Getting quality profile ID for: ${profileName}`);

        const response = await axios.get('/api/v3/qualityprofile');
        const profiles = response.data;

        const profile = profiles.find((p: any) => p.name === profileName);
        if (profile) {
            logger.debug(`Found quality profile: ${profileName} (ID: ${profile.id})`);
            return profile.id;
        } else {
            logger.error(`Quality profile not found: ${profileName}`);
            logger.debug('Available profiles:', profiles.map((p: any) => p.name));
            return null;
        }
    } catch (error) {
        logger.error('Error getting quality profiles:', error);
        return null;
    }
}

export async function getRootFolder(): Promise<string | null> {
    try {
        const response = await axios.get('/api/v3/rootfolder');
        const rootFolders = response.data;

        if (rootFolders.length > 0) {
            const rootFolder = rootFolders[0].path;
            logger.debug(`Using root folder: ${rootFolder}`);
            return rootFolder;
        } else {
            logger.error('No root folders found in Radarr');
            return null;
        }
    } catch (error) {
        logger.error('Error getting root folders:', error);
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
        logger.error(`Error getting root folder by id: ${id}`);
        return null;
    }
}

export async function getOrCreateTag(tagName: string): Promise<number | null> {
    try {
        logger.debug(`Getting or creating tag: ${tagName}`);

        const response = await axios.get('/api/v3/tag');
        const tags = response.data;

        const existingTag = tags.find((tag: any) => tag.label === tagName);
        if (existingTag) {
            logger.debug(`Tag already exists: ${tagName} (ID: ${existingTag.id})`);
            return existingTag.id;
        }

        logger.debug(`Creating new tag: ${tagName}`);
        const createResponse = await axios.post('/api/v3/tag', {
            label: tagName
        });

        logger.info(`Created tag: ${tagName} (ID: ${createResponse.data.id})`);
        return createResponse.data.id;
    } catch (error) {
        logger.error(`Error getting or creating tag ${tagName}:`, error);
        return null;
    }
}

function parseConfiguredTags(): string[] {
    const tags = [DEFAULT_TAG_NAME];

    if (env.RADARR_TAGS) {
        const userTags = env.RADARR_TAGS
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

    // Log warnings for any failed tag creations
    tagNames.forEach((tagName, index) => {
        if (tagIdsRaw[index] === null) {
            logger.warn(`Failed to create or retrieve tag: ${tagName}`);
        }
    });

    return tagIds;
}

export async function upsertMovies(movies: LetterboxdMovie[]): Promise<void> {
    const qualityProfileId = await getQualityProfileId(env.RADARR_QUALITY_PROFILE);

    if (!qualityProfileId) {
        throw new Error('Could not get quality profile ID.');
    }

    const rootFolderPath = !env.RADARR_ROOT_FOLDER_ID ? await getRootFolder() : await getRootFolderById(env.RADARR_ROOT_FOLDER_ID);

    if (!rootFolderPath) {
        throw new Error('Could not get root folder');
    }

    const tagIds = await getAllRequiredTagIds();

    await Bluebird.map(movies, movie => {
        return addMovie(movie, qualityProfileId, rootFolderPath, tagIds, env.RADARR_MINIMUM_AVAILABILITY);
    });
}

export async function addMovie(movie: LetterboxdMovie, qualityProfileId: number, rootFolderPath: string, tagIds: number[], minimumAvailability: string): Promise<void> {
    try {
        logger.debug(`Adding movie to Radarr: ${movie.name}`);

        if (!movie.tmdbId) {
            logger.info(`Could not add movie ${movie.name} because no tmdb id was found. Is this a TV show?`);
            return;
        }

        const payload: RadarrMovie = {
            title: movie.name,
            qualityProfileId,
            rootFolderPath,
            tmdbId: parseInt(movie.tmdbId),
            minimumAvailability,
            monitored: !env.RADARR_ADD_UNMONITORED,
            tags: tagIds,
            addOptions: {
                searchForMovie: true
            }
        }

        if (env.DRY_RUN) {
            logger.info(`[DRY RUN] Would add movie to Radarr: ${payload.title} (TMDB: ${payload.tmdbId})`, payload);
            return;
        }

        const response = await axios.post('/api/v3/movie', payload);

        logger.info(`Successfully added movie: ${payload.title}`, response.data);
        return response.data;
    } catch (e: any) {
        if (e.response?.status === 400 && (JSON.stringify(e.response?.data)).includes('This movie has already been added')) {
            logger.debug(`Movie ${movie.name} already exists in Radarr, updating tags`);
            await ensureMovieTags(movie, tagIds);
            return;
        }
        logger.error(`Error adding movie ${movie.name} (TMDB: ${movie.tmdbId}):`, e);
    }
}

/**
 * For movies that already exist in Radarr, ensure our tags are applied.
 * Fetches the existing movie by TMDB ID, merges the required tags, and
 * saves if any were missing.
 */
async function ensureMovieTags(movie: LetterboxdMovie, requiredTagIds: number[]): Promise<void> {
    if (!movie.tmdbId) return;

    try {
        const response = await axios.get(`/api/v3/movie`, {
            params: { tmdbId: parseInt(movie.tmdbId) }
        });

        const matches = response.data;
        if (!Array.isArray(matches) || matches.length === 0) {
            logger.debug(`Could not find existing movie ${movie.name} in Radarr for tag update`);
            return;
        }

        const existing = matches[0];
        const currentTags: number[] = existing.tags || [];
        const missingTags = requiredTagIds.filter(tid => !currentTags.includes(tid));

        if (missingTags.length === 0) {
            logger.debug(`Movie ${movie.name} already has all required tags`);
            return;
        }

        const updatedTags = [...new Set([...currentTags, ...requiredTagIds])];

        if (env.DRY_RUN) {
            logger.info(`[DRY RUN] Would update tags for existing movie: ${movie.name} (adding tags: ${missingTags.join(', ')})`);
            return;
        }

        await axios.put(`/api/v3/movie/${existing.id}`, {
            ...existing,
            tags: updatedTags,
        });

        logger.info(`Updated tags for existing movie: ${movie.name} (added tags: ${missingTags.join(', ')})`);
    } catch (error) {
        logger.error(`Error updating tags for ${movie.name}:`, error);
    }
}


// ── Sync-mode helpers (bidirectional sync: add + remove) ──

export interface RadarrExistingMovie {
    id: number;
    title: string;
    tmdbId: number;
    tags: number[];
}

/**
 * Get all movies currently in Radarr that carry ALL of the given tag IDs.
 */
export async function getMoviesByTagIds(tagIds: number[]): Promise<RadarrExistingMovie[]> {
    try {
        const response = await axios.get('/api/v3/movie');
        const allMovies: RadarrExistingMovie[] = response.data;
        // Keep only movies that have every one of the required tags.
        return allMovies.filter(m =>
            tagIds.every(tid => m.tags.includes(tid))
        );
    } catch (error) {
        logger.error('Error fetching movies from Radarr:', error);
        return [];
    }
}

/**
 * Delete a movie from Radarr by its Radarr internal ID.
 */
export async function deleteMovie(
    radarrId: number,
    { deleteFiles = true, addImportExclusion = false }: { deleteFiles?: boolean; addImportExclusion?: boolean } = {}
): Promise<void> {
    const params = new URLSearchParams({
        deleteFiles: String(deleteFiles),
        addImportExclusion: String(addImportExclusion),
    });
    await axios.delete(`/api/v3/movie/${radarrId}?${params.toString()}`);
}
