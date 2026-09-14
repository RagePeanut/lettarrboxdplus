// Covers the sync-mode helpers and the UPDATE_EXISTING_TAGS / EXCLUDE_TAGS
// branches of radarr.ts that the original radarr.test.ts does not exercise.
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
  RADARR_API_URL: 'http://localhost:7878',
  RADARR_API_KEY: 'test-key',
  RADARR_QUALITY_PROFILE: 'HD-1080p',
  RADARR_MINIMUM_AVAILABILITY: 'released',
  RADARR_TAGS: 'watchlist',
  RADARR_ADD_UNMONITORED: false,
  RADARR_ROOT_FOLDER_ID: undefined,
  EXCLUDE_TAGS: 'collection',
  UPDATE_EXISTING_TAGS: true,
  DELETE_FILES: true,
  ADD_IMPORT_EXCLUSION: false,
  DRY_RUN: false,
}));

import {
  getExcludedTagIds,
  getMoviesByTagIds,
  deleteMovie,
  removeTagsFromMovie,
  addMovie,
  upsertMovies,
  getRootFolderById,
} from './radarr';

describe('radarr sync helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getExcludedTagIds', () => {
    it('resolves configured exclude tag names to existing ids (case-insensitive)', async () => {
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

  describe('getMoviesByTagIds', () => {
    it('returns only movies carrying every required tag', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [
        { id: 1, title: 'A', tmdbId: 1, tags: [10, 20] },
        { id: 2, title: 'B', tmdbId: 2, tags: [10] },
      ]});
      const result = await getMoviesByTagIds([10, 20]);
      expect(result.map(m => m.id)).toEqual([1]);
    });

    it('returns [] on error', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('x'));
      expect(await getMoviesByTagIds([1])).toEqual([]);
    });
  });

  describe('deleteMovie', () => {
    it('issues a delete with query params', async () => {
      mockAxiosInstance.delete.mockResolvedValueOnce({});
      await deleteMovie(3, { deleteFiles: true, addImportExclusion: true });
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/v3/movie/3?deleteFiles=true&addImportExclusion=true');
    });

    it('defaults deleteFiles=true, addImportExclusion=false', async () => {
      mockAxiosInstance.delete.mockResolvedValueOnce({});
      await deleteMovie(4);
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/v3/movie/4?deleteFiles=true&addImportExclusion=false');
    });
  });

  describe('removeTagsFromMovie', () => {
    it('fetches the full movie and puts it back without removed tags', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 3, tags: [1, 2, 3] } });
      mockAxiosInstance.put.mockResolvedValueOnce({});
      await removeTagsFromMovie({ id: 3, title: 'C', tmdbId: 3, tags: [1, 2, 3] }, [2]);
      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/api/v3/movie/3', expect.objectContaining({ tags: [1, 3] }));
    });

    it('rethrows on error', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('nope'));
      await expect(removeTagsFromMovie({ id: 3, title: 'C', tmdbId: 3, tags: [] }, [1])).rejects.toThrow('nope');
    });
  });

  describe('getRootFolderById', () => {
    it('returns the path', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 2, path: '/movies2' } });
      expect(await getRootFolderById('2')).toBe('/movies2');
    });
  });

  describe('addMovie — UPDATE_EXISTING_TAGS path', () => {
    const movie = { id: 1, name: 'Existing', slug: '/film/x/', tmdbId: '500', imdbId: null, publishedYear: 2020 };

    it('updates tags when the movie already exists and tags are missing', async () => {
      mockAxiosInstance.post.mockRejectedValueOnce({ response: { status: 400, data: 'This movie has already been added' } });
      // ensureMovieTags: lookup existing then PUT
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 42, tags: [10] }] });
      mockAxiosInstance.put.mockResolvedValueOnce({});

      await addMovie(movie, 2, '/movies', [10, 20], 'released');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/api/v3/movie/42', expect.objectContaining({ tags: [10, 20] }));
    });

    it('does nothing extra when the existing movie already has all tags', async () => {
      mockAxiosInstance.post.mockRejectedValueOnce({ response: { status: 400, data: 'This movie has already been added' } });
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 42, tags: [10, 20] }] });

      await addMovie(movie, 2, '/movies', [10, 20], 'released');

      expect(mockAxiosInstance.put).not.toHaveBeenCalled();
    });
  });

  describe('upsertMovies', () => {
    it('resolves config and adds each movie', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: [{ id: 2, name: 'HD-1080p' }] }) // quality profile
        .mockResolvedValueOnce({ data: [{ id: 1, path: '/movies' }] })   // root folder
        .mockResolvedValue({ data: [] });                                 // tags
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: 1, label: 'letterboxd' } })
        .mockResolvedValueOnce({ data: { id: 2, label: 'watchlist' } })
        .mockResolvedValue({ data: { id: 100 } });                        // movie adds

      await upsertMovies([
        { id: 1, name: 'M1', slug: '/film/m1/', tmdbId: '1', imdbId: null, publishedYear: null },
      ]);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/v3/movie', expect.objectContaining({ title: 'M1' }));
    });
  });
});


// ── Additional branch coverage for radarr.ts ──
describe('radarr branch coverage', () => {
  beforeEach(() => jest.clearAllMocks());

  const movie = { id: 1, name: 'Existing', slug: '/film/x/', tmdbId: '500', imdbId: null, publishedYear: 2020 };

  it('addMovie logs (no post) in DRY_RUN mode', async () => {
    const env = require('../util/env');
    env.DRY_RUN = true;
    await addMovie(movie, 2, '/movies', [10], 'released');
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    env.DRY_RUN = false;
  });

  it('addMovie logs a generic error for a non-400 failure', async () => {
    mockAxiosInstance.post.mockRejectedValueOnce(new Error('network'));
    await expect(addMovie(movie, 2, '/movies', [10], 'released')).resolves.toBeUndefined();
  });

  it('ensureMovieTags: no matching existing movie found', async () => {
    mockAxiosInstance.post.mockRejectedValueOnce({ response: { status: 400, data: 'This movie has already been added' } });
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [] }); // lookup returns nothing
    await addMovie(movie, 2, '/movies', [10], 'released');
    expect(mockAxiosInstance.put).not.toHaveBeenCalled();
  });

  it('ensureMovieTags: handles lookup error gracefully', async () => {
    mockAxiosInstance.post.mockRejectedValueOnce({ response: { status: 400, data: 'This movie has already been added' } });
    mockAxiosInstance.get.mockRejectedValueOnce(new Error('lookup failed'));
    await expect(addMovie(movie, 2, '/movies', [10], 'released')).resolves.toBeUndefined();
  });

  it('getExcludedTagIds logs a debug note for names not present in Radarr', async () => {
    // EXCLUDE_TAGS is "collection"; return a tag list without it → missing branch.
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, label: 'something-else' }] });
    expect(await getExcludedTagIds()).toEqual([]);
  });
});
