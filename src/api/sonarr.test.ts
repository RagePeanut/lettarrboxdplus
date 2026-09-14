// Mock axios before importing sonarr
const mockAxiosInstance = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
};

jest.mock('axios', () => {
  return {
    create: jest.fn(() => mockAxiosInstance),
    default: {
      create: jest.fn(() => mockAxiosInstance),
    },
  };
});

jest.mock('../util/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../util/env', () => ({
  SONARR_API_URL: 'http://localhost:8989',
  SONARR_API_KEY: 'test-key',
  SONARR_QUALITY_PROFILE: 'HD-1080p',
  SONARR_TAGS: 'tag1,tag2',
  SONARR_ADD_UNMONITORED: false,
  SONARR_MONITOR_SEASONS: undefined,
  EXCLUDE_TAGS: undefined,
  UPDATE_EXISTING_TAGS: false,
  DRY_RUN: false,
}));

import {
  getQualityProfileId,
  getRootFolder,
  getOrCreateTag,
  getAllRequiredTagIds,
  addSeries,
  upsertSeries,
  getSeriesByTagIds,
  deleteSeries,
  removeTagsFromSeries,
} from './sonarr';

const mockSeries = { tmdbId: 12345, name: 'Test Show', seasons: [] as number[] };

const lookupResult = {
  title: 'Test Show',
  tvdbId: 999,
  year: 2020,
  seasons: [
    { seasonNumber: 1, monitored: false },
    { seasonNumber: 2, monitored: false },
  ],
};

describe('sonarr API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getQualityProfileId', () => {
    it('returns the profile id when it exists', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 2, name: 'HD-1080p' }] });
      expect(await getQualityProfileId('HD-1080p')).toBe(2);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v3/qualityprofile');
    });

    it('returns null when the profile is missing', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, name: 'SD' }] });
      expect(await getQualityProfileId('HD-1080p')).toBeNull();
    });

    it('returns null on error', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('boom'));
      expect(await getQualityProfileId('HD-1080p')).toBeNull();
    });
  });

  describe('getRootFolder', () => {
    it('returns the first root folder path', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, path: '/tv' }] });
      expect(await getRootFolder()).toBe('/tv');
    });

    it('returns null when none configured', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });
      expect(await getRootFolder()).toBeNull();
    });
  });

  describe('getOrCreateTag', () => {
    it('returns an existing tag id', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, label: 'serializd' }] });
      expect(await getOrCreateTag('serializd')).toBe(1);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('creates a tag when missing', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, label: 'new' } });
      expect(await getOrCreateTag('new')).toBe(5);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/v3/tag', { label: 'new' });
    });
  });

  describe('getAllRequiredTagIds', () => {
    it('resolves the default tag plus configured tags', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: 1, label: 'serializd' } })
        .mockResolvedValueOnce({ data: { id: 2, label: 'tag1' } })
        .mockResolvedValueOnce({ data: { id: 3, label: 'tag2' } });

      const result = await getAllRequiredTagIds();
      expect(result).toEqual(expect.arrayContaining([1, 2, 3]));
      expect(result).toHaveLength(3);
    });
  });

  describe('addSeries', () => {
    it('looks up by tmdb and posts the series with all seasons monitored', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [lookupResult] });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 1 } });

      await addSeries(mockSeries, 2, '/tv', [1, 2]);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v3/series/lookup', {
        params: { term: 'tmdb:12345' },
      });
      const [, payload] = mockAxiosInstance.post.mock.calls[0];
      expect(payload).toMatchObject({
        title: 'Test Show',
        tvdbId: 999,
        qualityProfileId: 2,
        rootFolderPath: '/tv',
        monitored: true,
        tags: [1, 2],
        addOptions: { searchForMissingEpisodes: true },
      });
      // No specific seasons requested → all seasons monitored.
      expect(payload.seasons).toEqual([
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
      ]);
    });

    it('only monitors the requested seasons', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [lookupResult] });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 1 } });

      await addSeries({ ...mockSeries, seasons: [2] }, 2, '/tv', [1]);

      const [, payload] = mockAxiosInstance.post.mock.calls[0];
      expect(payload.seasons).toEqual([
        { seasonNumber: 1, monitored: false },
        { seasonNumber: 2, monitored: true },
      ]);
    });

    it('uses the global monitor seasons when the series pins none', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [lookupResult] });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 1 } });

      await addSeries(mockSeries, 2, '/tv', [1], [1]);

      const [, payload] = mockAxiosInstance.post.mock.calls[0];
      expect(payload.seasons).toEqual([
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: false },
      ]);
    });

    it('skips when the lookup returns nothing', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });
      await addSeries(mockSeries, 2, '/tv', [1]);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('swallows the "already added" error', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [lookupResult] });
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 400, data: 'This series has already been added' },
      });
      await expect(addSeries(mockSeries, 2, '/tv', [1])).resolves.toBeUndefined();
    });
  });

  describe('upsertSeries', () => {
    it('resolves config then adds each series', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: [{ id: 2, name: 'HD-1080p' }] }) // quality profile
        .mockResolvedValueOnce({ data: [{ id: 1, path: '/tv' }] })       // root folder
        .mockResolvedValue({ data: [] });                                 // tags + lookups
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: 1, label: 'serializd' } })
        .mockResolvedValueOnce({ data: { id: 2, label: 'tag1' } })
        .mockResolvedValueOnce({ data: { id: 3, label: 'tag2' } });

      // lookups return nothing so nothing is posted as a series (keeps the test simple)
      await upsertSeries([mockSeries]);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v3/series/lookup', expect.anything());
    });

    it('throws when the quality profile is missing', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });
      await expect(upsertSeries([mockSeries])).rejects.toThrow('Could not get Sonarr quality profile ID.');
    });
  });

  describe('getSeriesByTagIds', () => {
    it('returns only series carrying all tags', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: [
          { id: 1, title: 'A', tmdbId: 1, tags: [10, 20] },
          { id: 2, title: 'B', tmdbId: 2, tags: [10] },
        ],
      });
      const result = await getSeriesByTagIds([10, 20]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });

  describe('deleteSeries', () => {
    it('deletes using the sonarr-specific addImportListExclusion param', async () => {
      mockAxiosInstance.delete.mockResolvedValueOnce({});
      await deleteSeries(7, { deleteFiles: true, addImportExclusion: true });
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
        '/api/v3/series/7?deleteFiles=true&addImportListExclusion=true'
      );
    });
  });

  describe('removeTagsFromSeries', () => {
    it('fetches the full series and puts it back without the removed tags', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 3, tags: [1, 2, 3] } });
      mockAxiosInstance.put.mockResolvedValueOnce({});

      await removeTagsFromSeries({ id: 3, title: 'C', tmdbId: 3, tags: [1, 2, 3] }, [2]);

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/api/v3/series/3', expect.objectContaining({ tags: [1, 3] }));
    });

    it('rethrows on error', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('nope'));
      await expect(removeTagsFromSeries({ id: 3, title: 'C', tmdbId: 3, tags: [] }, [1])).rejects.toThrow('nope');
    });
  });
});
