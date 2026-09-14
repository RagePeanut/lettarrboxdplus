import { SerializdScraper } from './serializd';

/**
 * A TV series scraped from a Serializd source.
 *
 * Serializd is backed by TMDB, so `tmdbId` is the show's TMDB id — the same id
 * Sonarr can look up via `/api/v3/series/lookup?term=tmdb:{id}`.
 *
 * `seasons` holds the specific season numbers to monitor. An empty array means
 * "monitor all seasons".
 */
export interface SerializdSeries {
    tmdbId: number;
    name: string;
    seasons: number[];
}

export enum SerializdListType {
    WATCHLIST = 'watchlist',
    USER_LIST = 'user_list',
    PUBLIC_LIST = 'public_list',
}

export const SERIALIZD_BASE_URL = 'https://serializd.com';

// The public (unofficial) Serializd JSON API. This is the same host the web/app
// clients talk to; sending the X-Requested-With header below is enough to read
// public content without authentication.
export const SERIALIZD_API_URL = 'https://serializd.onrender.com';

export const SERIALIZD_API_HEADERS = {
    'X-Requested-With': 'serializd_vercel',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const URL_PATTERNS = {
    // https://serializd.com/user/{username}/watchlist
    [SerializdListType.WATCHLIST]: /^https:\/\/(?:www\.)?serializd\.com\/user\/[^/]+\/watchlist\/?$/,
    // https://serializd.com/user/{username}/lists/{slug}
    [SerializdListType.USER_LIST]: /^https:\/\/(?:www\.)?serializd\.com\/user\/[^/]+\/lists\/[^/?]+\/?$/,
    // https://serializd.com/list/{slug-or-id}
    [SerializdListType.PUBLIC_LIST]: /^https:\/\/(?:www\.)?serializd\.com\/list\/[^/?]+\/?$/,
};

export const detectSerializdListType = (url: string): SerializdListType | null => {
    for (const [listType, pattern] of Object.entries(URL_PATTERNS)) {
        if (pattern.test(url)) {
            return listType as SerializdListType;
        }
    }
    return null;
};

export const fetchSeriesFromUrl = async (url: string): Promise<SerializdSeries[]> => {
    const listType = detectSerializdListType(url);

    if (!listType) {
        throw new Error(`Unsupported Serializd URL format: ${url}`);
    }

    const scraper = new SerializdScraper(url, listType);
    return scraper.getSeries();
};
