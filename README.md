# Lettarrboxd+

A fork of [Lettarrboxd](https://github.com/ryanpag3/lettarrboxd) with **bidirectional sync**: movies removed from your Letterboxd list are also removed from Radarr.

## What's new vs Lettarrboxd

- **Sync mode** (`SYNC_MODE=sync`): makes your Letterboxd list the single source of truth. Movies added to the list are added to Radarr; movies removed from the list are removed from Radarr (with optional file deletion).
- **Removal protection** (`EXCLUDE_TAGS`): protect movies carrying specific tags from sync removal — essential when running multiple sync instances (e.g. a watchlist that auto-cleans watched films alongside a protected collection).
- **Tag updating for existing movies** (`UPDATE_EXISTING_TAGS=true`): when a movie already exists in Radarr (e.g. added by another instance), the configured tags are applied to it instead of silently skipping. Required for sync mode to work correctly. Defaults to `false` to preserve original behavior.
- Fully **backward-compatible**: if you don't set `SYNC_MODE`, the behavior is identical to the original Lettarrboxd.

## Overview

Lettarrboxd+ monitors your Letterboxd lists (watchlists, regular lists, watched movies, filmographies, collections, etc.) and automatically syncs them with Radarr. It runs continuously, checking for updates at configurable intervals.

## Supported Letterboxd URLs

The application supports various types of Letterboxd URLs for the `LETTERBOXD_URL` environment variable:

- **Watchlists**: `https://letterboxd.com/username/watchlist/`
- **Regular Lists**: `https://letterboxd.com/username/list/list-name/`
- **Watched Movies**: `https://letterboxd.com/username/films/`
- **Collections**: `https://letterboxd.com/films/in/collection-name/`
- **Popular Movies**: `https://letterboxd.com/films/popular/`
- **Actor Filmography**: `https://letterboxd.com/actor/actor-name/`
- **Director Filmography**: `https://letterboxd.com/director/director-name/`
- **Writer Filmography**: `https://letterboxd.com/writer/writer-name/`

### Examples
```bash
# User's watchlist
LETTERBOXD_URL=https://letterboxd.com/moviefan123/watchlist/

# User's custom list
LETTERBOXD_URL=https://letterboxd.com/dave/list/official-top-250-narrative-feature-films/

# User's watched movies
LETTERBOXD_URL=https://letterboxd.com/moviefan123/films/

# Movie collection
LETTERBOXD_URL=https://letterboxd.com/films/in/the-dark-knight-collection/

# Popular movies
LETTERBOXD_URL=https://letterboxd.com/films/popular/

# Another user's list
LETTERBOXD_URL=https://letterboxd.com/criterion/list/the-criterion-collection/

# Actor filmography (e.g., Tom Hanks)
LETTERBOXD_URL=https://letterboxd.com/actor/tom-hanks/

# Director filmography (e.g., Christopher Nolan)
LETTERBOXD_URL=https://letterboxd.com/director/christopher-nolan/

# Writer filmography (e.g., Aaron Sorkin)
LETTERBOXD_URL=https://letterboxd.com/writer/aaron-sorkin/
```

**Note**: All Letterboxd lists must be public for the application to access them.

## Quick Start

### Docker

```bash
docker run -d \
  --name lettarrboxd \
  -e LETTERBOXD_URL=https://letterboxd.com/your_username/watchlist/ \
  -e RADARR_API_URL=http://your-radarr:7878 \
  -e RADARR_API_KEY=your_api_key \
  -e RADARR_QUALITY_PROFILE="HD-1080p" \
  -e RADARR_TAGS="watchlist,must-watch" \
  -e DRY_RUN=false \
  ryanpage/lettarrboxd:latest
```

For testing purposes, you can enable dry run mode:
```bash
docker run -d \
  --name lettarrboxd-test \
  -e LETTERBOXD_URL=https://letterboxd.com/your_username/watchlist/ \
  -e RADARR_API_URL=http://your-radarr:7878 \
  -e RADARR_API_KEY=your_api_key \
  -e RADARR_QUALITY_PROFILE="HD-1080p" \
  -e DRY_RUN=true \
  ryanpage/lettarrboxd:latest
```
See [docker-compose.yaml](./docker-compose.yaml) for complete example.

## Watching Multiple Lists

To monitor multiple Letterboxd lists simultaneously, deploy one lettarrboxd instance per list. Each instance operates independently with its own configuration, allowing you to:

- Watch different lists with different quality profiles
- Use custom tags to organize movies from different sources
- Set different check intervals for each list
- Maintain separate data directories to track each list's state

### Docker Compose Multi-List Example

```yaml
services:
  lettarrboxd-watchlist:
    image: ryanpage/lettarrboxd:latest
    container_name: lettarrboxd-watchlist
    environment:
      - LETTERBOXD_URL=https://letterboxd.com/your_username/watchlist/
      - RADARR_API_URL=http://radarr:7878
      - RADARR_API_KEY=your_api_key
      - RADARR_QUALITY_PROFILE=HD-1080p
      - RADARR_TAGS=watchlist,personal
      - CHECK_INTERVAL_MINUTES=60
    volumes:
      - ./data/watchlist:/data
    restart: unless-stopped

  lettarrboxd-criterion:
    image: ryanpage/lettarrboxd:latest
    container_name: lettarrboxd-criterion
    environment:
      - LETTERBOXD_URL=https://letterboxd.com/criterion/list/the-criterion-collection/
      - RADARR_API_URL=http://radarr:7878
      - RADARR_API_KEY=your_api_key
      - RADARR_QUALITY_PROFILE=HD-1080p
      - RADARR_TAGS=criterion,classics
      - CHECK_INTERVAL_MINUTES=120
    volumes:
      - ./data/criterion:/data
    restart: unless-stopped

  lettarrboxd-nolan:
    image: ryanpage/lettarrboxd:latest
    container_name: lettarrboxd-nolan
    environment:
      - LETTERBOXD_URL=https://letterboxd.com/director/christopher-nolan/
      - RADARR_API_URL=http://radarr:7878
      - RADARR_API_KEY=your_api_key
      - RADARR_QUALITY_PROFILE=Ultra HD
      - RADARR_TAGS=nolan,director-filmography
      - CHECK_INTERVAL_MINUTES=1440  # Check once per day
    volumes:
      - ./data/nolan:/data
    restart: unless-stopped
```

### Docker CLI Multi-List Example

```bash
# Watch your personal watchlist
docker run -d \
  --name lettarrboxd-watchlist \
  -e LETTERBOXD_URL=https://letterboxd.com/your_username/watchlist/ \
  -e RADARR_API_URL=http://radarr:7878 \
  -e RADARR_API_KEY=your_api_key \
  -e RADARR_QUALITY_PROFILE="HD-1080p" \
  -e RADARR_TAGS="watchlist,personal" \
  -e CHECK_INTERVAL_MINUTES=60 \
  -v ./data/watchlist:/data \
  ryanpage/lettarrboxd:latest

# Watch the Criterion Collection
docker run -d \
  --name lettarrboxd-criterion \
  -e LETTERBOXD_URL=https://letterboxd.com/criterion/list/the-criterion-collection/ \
  -e RADARR_API_URL=http://radarr:7878 \
  -e RADARR_API_KEY=your_api_key \
  -e RADARR_QUALITY_PROFILE="HD-1080p" \
  -e RADARR_TAGS="criterion,classics" \
  -e CHECK_INTERVAL_MINUTES=120 \
  -v ./data/criterion:/data \
  ryanpage/lettarrboxd:latest

# Watch Christopher Nolan's filmography
docker run -d \
  --name lettarrboxd-nolan \
  -e LETTERBOXD_URL=https://letterboxd.com/director/christopher-nolan/ \
  -e RADARR_API_URL=http://radarr:7878 \
  -e RADARR_API_KEY=your_api_key \
  -e RADARR_QUALITY_PROFILE="Ultra HD" \
  -e RADARR_TAGS="nolan,director-filmography" \
  -e CHECK_INTERVAL_MINUTES=1440 \
  -v ./data/nolan:/data \
  ryanpage/lettarrboxd:latest
```

### Best Practices for Multi-List Setup

1. **Unique Container Names**: Each instance must have a unique container name (e.g., `lettarrboxd-watchlist`, `lettarrboxd-criterion`)

2. **Separate Data Directories**: Use different volume mounts for each instance to maintain independent state tracking:
   ```yaml
   volumes:
     - ./data/watchlist:/data    # Instance 1
     - ./data/criterion:/data    # Instance 2
   ```

3. **Distinctive Tags**: Use the `RADARR_TAGS` variable to organize movies by source:
   ```yaml
   - RADARR_TAGS=watchlist,personal
   - RADARR_TAGS=criterion,classics
   - RADARR_TAGS=nolan,director-filmography
   ```

4. **Appropriate Check Intervals**: Adjust `CHECK_INTERVAL_MINUTES` based on how frequently each list updates:
   - Personal watchlists: 30-60 minutes
   - Curated lists: 2-24 hours
   - Static collections: 24 hours or more

5. **Quality Profiles**: Each instance can use different quality profiles based on content type:
   ```yaml
   - RADARR_QUALITY_PROFILE=HD-1080p      # Standard content
   - RADARR_QUALITY_PROFILE=Ultra HD       # Premium content
   ```

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `LETTERBOXD_URL` | Your Letterboxd list URL | `https://letterboxd.com/moviefan123/watchlist/` |
| `RADARR_API_URL` | Radarr base URL | `http://radarr:7878` |
| `RADARR_API_KEY` | Radarr API key | `abc123...` |
| `RADARR_QUALITY_PROFILE` | Quality profile name in Radarr | `HD-1080p` |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHECK_INTERVAL_MINUTES` | `10` | How often to check for new movies (minimum 10) |
| `RADARR_MINIMUM_AVAILABILITY` | `released` | When movie becomes available (`announced`, `inCinemas`, `released`) |
| `RADARR_ROOT_FOLDER_ID` | - | Specific root folder ID to use in Radarr (uses first available if not set) |
| `RADARR_ADD_UNMONITORED` | `false` | When `true`, adds movies to Radarr in an unmonitored state |
| `RADARR_TAGS` | - | Additional tags to apply to movies (comma-separated). Movies are always tagged with `letterboxd` |
| `LETTERBOXD_TAKE_AMOUNT` | - | Number of movies to sync (requires `LETTERBOXD_TAKE_STRATEGY`) |
| `LETTERBOXD_TAKE_STRATEGY` | - | Movie selection strategy: `newest` or `oldest` (requires `LETTERBOXD_TAKE_AMOUNT`) |
| `DRY_RUN` | `false` | When `true`, logs what would be added/removed without making actual API calls |
| `DATA_DIR` | `/data` | Directory for storing application data. You generally do not need to worry about this. |
| `SYNC_MODE` | `add` | `add` (default): only add movies to Radarr. `sync`: bidirectional — also remove movies from Radarr when they are removed from the Letterboxd list |
| `DELETE_FILES` | `true` | When removing movies in sync mode, also delete the files from disk |
| `ADD_IMPORT_EXCLUSION` | `false` | When removing movies in sync mode, add an import exclusion to prevent Radarr from re-adding the movie |
| `UPDATE_EXISTING_TAGS` | `false` | When `true`, update tags on movies that already exist in Radarr. Required for `SYNC_MODE=sync` to work correctly. When `false` (default), existing movies are silently skipped (original Lettarrboxd behavior) |
| `EXCLUDE_TAGS` | - | Comma-separated tag names that protect movies from removal in sync mode. A movie carrying any of these tags is never removed, even if it's no longer on the list. Useful when running multiple sync instances (e.g. protect a `collection` from a watchlist instance) |

## Sync Mode (Bidirectional)

When `SYNC_MODE=sync`, the Letterboxd list becomes the **single source of truth** for which movies should be in Radarr (with your configured tags). Each cycle:

1. The list is scraped and new movies are added to Radarr (same as `add` mode).
2. All Radarr movies carrying the configured `RADARR_TAGS` are queried.
3. Movies in Radarr (with matching tags) that are **no longer on the Letterboxd list** are **removed** from Radarr.

This is ideal for curated collections — add a movie to your Letterboxd list and it downloads; remove it and it's cleaned up automatically.

### How removal works

- Removal only targets movies with **all** your configured tags. Movies added by other instances (with different tags) are never touched.
- `DELETE_FILES=true` (default): files are deleted from disk, freeing space. Plex reflects the removal automatically.
- `ADD_IMPORT_EXCLUSION=false` (default): the movie can be re-added later (e.g. by another Lettarrboxd instance monitoring your watchlist). Set to `true` if you want removal to be permanent.
- Respects `DRY_RUN`: when enabled, removals are logged but not executed.

### Tag updating for existing movies

When a movie on the Letterboxd list **already exists** in Radarr (e.g. added by a different instance), the original Lettarrboxd silently skips it without applying tags. When `UPDATE_EXISTING_TAGS=true`, Lettarrboxd+ instead **updates the existing movie's tags** to include the configured tags. This ensures the sync-mode removal logic can correctly identify which movies belong to which list.

> **Note:** `UPDATE_EXISTING_TAGS` defaults to `false` to preserve the original Lettarrboxd behavior. If you use `SYNC_MODE=sync`, you should set `UPDATE_EXISTING_TAGS=true` — otherwise movies that already exist in Radarr won't get the tags needed for sync removal to work.

### Protecting movies from removal (`EXCLUDE_TAGS`)

When running **multiple sync instances**, a movie removed from one list might still belong to another. `EXCLUDE_TAGS` protects movies carrying specific tags from being removed.

**Example — watchlist auto-cleanup + a protected collection:**

Letterboxd automatically removes a film from your watchlist once you log it as watched. Combined with `SYNC_MODE=sync`, this means watched films are automatically cleaned up from Radarr. But you may want to keep some films permanently — put those on a separate "Digital Collection" list (tagged `collection`), and tell the watchlist instance to never remove `collection`-tagged films:

```yaml
  # Watchlist: adds films you want; removes them once watched (dropped from watchlist)
  lettarrboxdplus-watchlist:
    build: ./lettarrboxdplus
    container_name: lettarrboxdplus-watchlist
    environment:
      - LETTERBOXD_URL=https://letterboxd.com/your_username/watchlist/
      - RADARR_API_URL=http://radarr:7878
      - RADARR_API_KEY=your_api_key
      - RADARR_QUALITY_PROFILE=Any
      - RADARR_TAGS=watchlist
      - SYNC_MODE=sync
      - UPDATE_EXISTING_TAGS=true
      - EXCLUDE_TAGS=collection      # never remove films in the collection
      - DELETE_FILES=true
    volumes:
      - ./data/watchlist:/data
    restart: unless-stopped

  # Digital Collection: your permanent keepers, tagged `collection`
  lettarrboxdplus-collection:
    build: ./lettarrboxdplus
    container_name: lettarrboxdplus-collection
    environment:
      - LETTERBOXD_URL=https://letterboxd.com/your_username/list/digital-collection/
      - RADARR_API_URL=http://radarr:7878
      - RADARR_API_KEY=your_api_key
      - RADARR_QUALITY_PROFILE=Any
      - RADARR_TAGS=collection
      - SYNC_MODE=sync
      - UPDATE_EXISTING_TAGS=true
      - DELETE_FILES=true
    volumes:
      - ./data/collection:/data
    restart: unless-stopped
```

Now: watch a film → it drops off your watchlist → removed from Radarr. But if that film is also on your Digital Collection, the `collection` tag protects it from the watchlist instance's removal.

### Example: Digital Collection

Use a dedicated Letterboxd list as your "permanent collection" — movies you want to keep on disk:

```yaml
  lettarrboxdplus-collection:
    build: ./lettarrboxdplus
    container_name: lettarrboxdplus-collection
    environment:
      - LETTERBOXD_URL=https://letterboxd.com/your_username/list/digital-collection/
      - RADARR_API_URL=http://radarr:7878
      - RADARR_API_KEY=your_api_key
      - RADARR_QUALITY_PROFILE=Any
      - RADARR_TAGS=collection
      - SYNC_MODE=sync
      - UPDATE_EXISTING_TAGS=true
      - DELETE_FILES=true
      - ADD_IMPORT_EXCLUSION=false
      - CHECK_INTERVAL_MINUTES=120
      - DRY_RUN=true   # Verify first, then set to false
    volumes:
      - ./data/collection:/data
    restart: unless-stopped
```

- Add a film to "Digital Collection" on Letterboxd → it downloads, tagged `collection`.
- Remove a film from the list → next sync removes it from Radarr + deletes the files.
- Movies added by your watchlist instance (tagged `watchlist`) are unaffected.

## Development

### Prerequisites

- Node.js 20+
- Yarn package manager

### Setup

```bash
# Clone the repository
git clone https://github.com/ryanpag3/lettarrboxd.git
cd lettarrboxd

# Install dependencies
yarn install

# Create environment file
cp .env.example .env
# Edit .env with your configuration

# Run in development mode
yarn start:dev
```

### Development Commands

```bash
yarn start:dev    # Run with auto-reload
yarn tsc          # Compile TypeScript
yarn tsc --noEmit # Type check only
```

### Development Mode

When `NODE_ENV=development`, the application:
- Only processes the first 5 movies (for faster testing)
- Uses more verbose logging
- Includes additional debug information

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Common Issues

**Movies not being added**
- Verify your Radarr API key and URL are correct
- Check that the quality profile name matches exactly (case-sensitive)
- Ensure your Letterboxd list is public

**Docker container won't start**
- Verify all required environment variables are set
- Check container logs: `docker logs lettarrboxd`

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Legal Disclaimer

This project is intended for use with legally sourced media only. It is designed to help users organize and manage their personal media collections. The developers of Lettarrboxd do not condone or support piracy in any form. Users are solely responsible for ensuring their use of this software complies with all applicable laws and regulations in their jurisdiction.
