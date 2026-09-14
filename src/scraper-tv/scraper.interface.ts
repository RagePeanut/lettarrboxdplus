import { SerializdSeries } from '.';

/**
 * Contract for any Serializd source scraper (watchlist, user list, public list).
 * Mirrors the movie-side Scraper interface in src/scraper/scraper.interface.ts.
 */
export interface SeriesScraper {
    getSeries(): Promise<SerializdSeries[]>;
}
