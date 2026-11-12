# API Aberta — Geographic Data Connector

Microservice for Portuguese geographic data (municipalities, districts, parishes, postal codes) sourced from [geoapi.pt](https://geoapi.pt/) / CAOP.

Version **1.1.0** is a memory-oriented release: GeoJSON stays in MongoDB, not in the Node process, and the daily ingest no longer collides with `connector-gtfs`.

## Features

- Administrative divisions (CAOP)
- Postal codes (CTT, via geoapi.pt)
- District / municipality / parish hierarchy

## Endpoints

The process also serves these under the `/geo` prefix (the gateway strips `/v1` and keeps `/geo`).

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Root health (gateway polling). Includes `version`. |
| `GET` | `/geo/health` | Prefixed health. |
| `GET` | `/geo/meta` | Counts + `last_sync`. Does not load geometry. |
| `GET` | `/geo/districts` | List. **Omits `geojson` unless `?geojson=true`.** |
| `GET` | `/geo/districts/:id` | Lookup by `codigoine`. Includes `geojson` by default; pass `?geojson=false` to drop it. |
| `GET` | `/geo/municipalities` | Paged list (`page`, `limit`, `district`). Omits `geojson` unless `?geojson=true`. |
| `GET` | `/geo/municipalities/:slug` | Lookup. Includes `geojson` by default; `?geojson=false` drops it. |
| `GET` | `/geo/municipalities/:slug/parishes` | Parishes of one municipality (loads municipality `name` only). |
| `GET` | `/geo/parishes` | Optional `?municipality=` filter. |
| `GET` | `/geo/postal/:code` | Postal lookup `XXXX-XXX`, proxied to geoapi.pt. |

List/lookup routes use Mongo projections so geometry is not read from WiredTiger unless the response actually needs it. Responses that include GeoJSON are **not** stored in the in-memory cache.

## Setup

```bash
npm install
cp .env.example .env
npm test
npm start
```

Tests (`npm test`) use in-memory stubs. They never connect to MongoDB. `NODE_ENV=test` / `dev` refuse a non-local `MONGO_URI`.

## Ingest

- **Cron:** `45 4 * * *` `Europe/Lisbon` (override with `SYNC_CRON` / `SYNC_TZ`). Moved off `03:30` so it does not run with `connector-gtfs`.
- **Incremental:** documents with `synced_at` newer than `SYNC_REFRESH_DAYS` (default 7) are skipped. CAOP polygons change rarely; this avoids re-parsing hundreds of KiB–MiB GeoJSON blobs every night.
- **Startup:** skipped when data is newer than `SYNC_STARTUP_MAX_AGE_HOURS` (default 24). Set `SYNC_ON_STARTUP=1` to force, `0` to never.
- **Full refresh:** `SYNC_FULL=1` (or `runSync({ full: true })`) refetches geometry.
- Districts are fetched **one at a time** from `/distrito/{name}`. The connector **never** calls `GET /distritos` or `GET /distritos/municipios` (~17 MiB JSON dumps). Names come from a CAOP catalog of 29 districts/islands plus rows already in Mongo.
- Municipalities: `GET /municipios` (name list, ~4 KiB) then `/municipio/{name}` with concurrency `SYNC_CONCURRENCY` (default 2). Upserts use `updateOne` (no `new: true` round-trip of the stored GeoJSON).
- Parishes: `GET /freguesias` (~117 KiB, no geometry) then `bulkWrite` batches of `SYNC_PARISH_BATCH`.

## Memory

Observed production peak before 1.1.0: **308 MiB** RSS vs `max_memory_restart` 300M, after a restart that immediately ran a full ingest.

| Change | Expected effect |
| --- | --- |
| Stop `GET /distritos` (~17 MiB parse of every district polygon at once) | Removes the largest ingest spike (~50–80 MiB of V8 objects from one `JSON.parse`) |
| One district / two municipalities in flight; `updateOne` without returning the doc | Peak GeoJSON in heap ≈ one Faro-sized blob (~2.4 MiB) instead of 29 + 5 concurrent municipalities |
| Skip fresh docs (7 days) and skip startup ingest when data is recent | Nightly/restart cost ≈ name lists + `{ slug, synced_at }` projections (KiB), not 72 MiB of stored geometry |
| Bounded cache (250 entries / 1 MiB / 64 KiB max value); never cache GeoJSON | Resident cache stays under ~1 MiB instead of holding `districts?geojson=true` (~22 MiB) or slug lookups (168 KiB × N) |
| List routes project `{ geojson: 0 }`; nested parishes select `{ name: 1 }` | List/meta traffic does not pull 168–776 KiB documents into the Node heap |
| `NODE_OPTIONS=--max-old-space-size=192` | Caps V8 old space under the 300M PM2 restart limit |

Steady-state RSS should sit with the other small connectors (tens of MiB), with ingest peaks well under 300 MiB.

## Indexes

**No index changes in 1.1.0.** Existing indexes (all created by the schemas, none added here):

- `districts.codigoine` unique
- `municipalities.codigoine`, `name`, `slug` unique, `district`
- `parishes.name`, `municipality`, `district`, unique `{ name: 1, municipality: 1 }`

A `synced_at` index was considered for the incremental skip and rejected: 29 districts and 308 municipalities fit in a `{ slug, synced_at }` projection without one.

## Data Sources

- CAOP (Carta Administrativa Oficial de Portugal)
- CTT postal codes
- geoapi.pt

## License

MIT
