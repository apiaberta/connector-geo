# connector-geo

API Aberta connector for geographic data powered by [geoapi.pt](https://geoapi.pt).

Provides REST endpoints for Portuguese districts, municipalities, parishes, and postal codes.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |
| GET | `/districts` | List all districts (`?geojson=true` to include GeoJSON) |
| GET | `/districts/:id` | District by codigoine |
| GET | `/municipalities` | List municipalities (`?district=Lisboa&page=1&limit=50`) |
| GET | `/municipalities/:slug` | Municipality by slug (e.g. `lisboa`, `porto`) |
| GET | `/municipalities/:slug/parishes` | Parishes of a municipality |
| GET | `/parishes` | All parishes (`?municipality=Lisboa`) |
| GET | `/postal/:code` | Postal code lookup (e.g. `1000-001`) |
| GET | `/meta` | Sync stats and record counts |

Via gateway: `https://api.apiaberta.pt/v1/geo/<endpoint>`

## Stack

- **Runtime:** Node.js ESM
- **Framework:** Fastify
- **Database:** MongoDB
- **Source:** [geoapi.pt](https://geoapi.pt)

## Data Sync

On startup and daily at 03:30 UTC, syncs:
- 29 districts from `geoapi.pt/distritos`
- 308 municipalities from `geoapi.pt/municipios` (detail per municipality, concurrency=5)
- ~3000+ parishes from `geoapi.pt/freguesias`

Initial sync takes ~5 minutes due to rate limiting.

## Setup

```bash
cp .env.example .env
npm ci
npm start
```

## Environment Variables

```
PORT=3009
MONGO_URI=mongodb://localhost:27017/apiaberta-geo
NODE_ENV=production
```
