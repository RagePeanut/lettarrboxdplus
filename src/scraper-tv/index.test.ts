jest.mock('../util/env', () => ({}));

const mockGetSeries = jest.fn();
jest.mock('./serializd', () => ({
  SerializdScraper: jest.fn().mockImplementation(() => ({
    getSeries: mockGetSeries,
  })),
}));

import { detectSerializdListType, fetchSeriesFromUrl, SerializdListType } from './index';
import { SerializdScraper } from './serializd';

describe('serializd scraper index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectSerializdListType', () => {
    it('detects a watchlist URL', () => {
      expect(detectSerializdListType('https://serializd.com/user/bob/watchlist')).toBe(SerializdListType.WATCHLIST);
      expect(detectSerializdListType('https://serializd.com/user/bob/watchlist/')).toBe(SerializdListType.WATCHLIST);
      expect(detectSerializdListType('https://www.serializd.com/user/bob/watchlist')).toBe(SerializdListType.WATCHLIST);
    });

    it('detects a user list URL', () => {
      expect(detectSerializdListType('https://serializd.com/user/bob/lists/my-shows')).toBe(SerializdListType.USER_LIST);
    });

    it('detects a public list URL', () => {
      expect(detectSerializdListType('https://serializd.com/list/Best-Shows-123')).toBe(SerializdListType.PUBLIC_LIST);
    });

    it('returns null for unsupported URLs', () => {
      expect(detectSerializdListType('https://serializd.com/user/bob')).toBeNull();
      expect(detectSerializdListType('https://letterboxd.com/user/watchlist')).toBeNull();
      expect(detectSerializdListType('not a url')).toBeNull();
    });
  });

  describe('fetchSeriesFromUrl', () => {
    it('throws on an unsupported URL', async () => {
      await expect(fetchSeriesFromUrl('https://serializd.com/user/bob')).rejects.toThrow('Unsupported Serializd URL format');
    });

    it('dispatches to the scraper and returns its result', async () => {
      const series = [{ tmdbId: 1, name: 'Show', seasons: [] }];
      mockGetSeries.mockResolvedValue(series);

      const result = await fetchSeriesFromUrl('https://serializd.com/user/bob/watchlist');

      expect(SerializdScraper).toHaveBeenCalledWith('https://serializd.com/user/bob/watchlist', SerializdListType.WATCHLIST);
      expect(result).toBe(series);
    });
  });
});
