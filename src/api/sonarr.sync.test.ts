// Covers the sync-mode helpers and the UPDATE_EXISTING_TAGS / EXCLUDE_TAGS /
// SONARR_MONITOR_SEASONS branches of sonarr.ts not exercised by sonarr.test.ts.
const mockAxiosInstance = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
};

jest.mock('axios', () => ({
  create: jest.fn(() => mockAxiosInstance),
  default: { create: jest.fn(() => mockAxiosInstance) },
}));

jest.mock('../util/logger', () => ({
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

jest.mock('../util/env', () => ({
  SONARR_API_URL: 'http://localhost:8989',
  SONARR_API_KEY: 'test-key',
  SONARR_QUALITY_PROFILE: 'HD-1080p',
  SONARR_TAGS: 'serializd-watchlist',
  SONARR_ADD_UNMONITORED: false,
  SONARR_ROOT_FOLDER_ID: '1',
  SONARR_MONITOR_SEASONS: '1,2',
  EXCLUDE_TAGS: 'collection',
  UPDATE_EXISTING_TAGS: true,
  DELETE_FILES: true,
  ADD_IMPORT_EXCLUSION: false,
  DRY_RUN: false,
}));

import {
  getExcludedTagIds,
  getGlobalMonitorSeasons,
  getRootFolderById,
  addSeries,
  upsertSeries,
} from './sonarr';

const lookupResult = {
  title: 'Show',
  tvdbId: 999,
  year: 2020,
  seasons: [
    { seasonNumber: 1, monitored: false },
    { seasonNumber: 2, monitored: false },
    { seasonNumber: 3, monitored: false },
  ],
};

describe('sonarr sync helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getExcludedTagIds', () => {
    it('resolves exclude tag names to existing ids (case-insensitive)', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [
        { id: 5, label: 'Collection' },
        { id: 6, label: 'other' },
      ]});
      expect(await getExcludedTagIds()).toEqual([5]);
    });

    it('returns [] on error', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('x'));
      expect(await getExcludedTagIds()).toEqual([]);
    });
  });

  describe('getGlobalMonitorSeasons', () => {
    it('parses SONARR_MONITOR_SEASONS into numbers', () => {
      expect(getGlobalMonitorSeasons()).toEqual([1, 2]);
    });
  });

  describe('getRootFolderById', () => {
    it('returns the path', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 1, path: '/tv' } });
      expect(await getRootFolderById('1')).toBe('/tv');
    });
  });

  describe('addSeries — global monitor seasons', () => {
    it('monitors the SONARR_MONITOR_SEASONS default when the series pins none', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [lookupResult] });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 1 } });

      await addSeries({ tmdbId: 12345, name: 'Show', seasons: [] }, 2, '/tv', [10], [1, 2]);

      const [, payload] = mockAxiosInstance.post.mock.calls[0];
      expect(payload.seasons).toEqual([
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
        { seasonNumber: 3, monitored: false },
      ]);
    });
  });

  describe('addSeries — UPDATE_EXISTING_TAGS path', () => {
    const series = { tmdbId: 500, name: 'Existing', seasons: [] };

    it('updates tags when the series already exists and tags are missing', async () => {
      // lookup succeeds, then POST fails with "already added"
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [lookupResult] });
      mockAxiosInstance.post.mockRejectedValueOnce({ response: { status: 400, data: 'This series has already been added' } });
      // ensureSeriesTags: lookup existing then PUT
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 42, tags: [10] }] });
      mockAxiosInstance.put.mockResolvedValueOnce({});

      await addSeries(series, 2, '/tv', [10, 20]);

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/api/v3/series/42', expect.objectContaining({ tags: [10, 20] }));
    });

    it('does nothing extra when the existing series already has all tags', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [lookupResult] });
      mockAxiosInstance.post.mockRejectedValueOnce({ response: { status: 400, data: 'This series has already been added' } });
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 42, tags: [10, 20] }] });

      await addSeries(series, 2, '/tv', [10, 20]);

      expect(mockAxiosInstance.put).not.toHaveBeenCalled();
    });
  });

  describe('upsertSeries', () => {
    it('resolves config (root folder by id) and adds each series', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: [{ id: 2, name: 'HD-1080p' }] }) // quality profile
        .mockResolvedValueOnce({ data: { id: 1, path: '/tv' } })         // root folder by id
        .mockResolvedValueOnce({ data: [] })                             // tag lookup (serializd)
        .mockResolvedValueOnce({ data: [] })                             // tag lookup (serializd-watchlist)
        .mockResolvedValueOnce({ data: [lookupResult] });                // series lookup
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: 1, label: 'serializd' } })
        .mockResolvedValueOnce({ data: { id: 2, label: 'serializd-watchlist' } })
        .mockResolvedValueOnce({ data: { id: 100 } });                   // series add

      await upsertSeries([{ tmdbId: 12345, name: 'Show', seasons: [] }]);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/v3/series', expect.objectContaining({ title: 'Show' }));
    });

    it('throws when the quality profile is missing', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });
      await expect(upsertSeries([{ tmdbId: 1, name: 'X', seasons: [] }])).rejects.toThrow('Could not get Sonarr quality profile ID.');
    });
  });
});
