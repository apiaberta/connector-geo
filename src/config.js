import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8')
)

export const SERVICE_NAME = 'connector-geo'
export const VERSION = pkg.version

export const PORT = parseInt(process.env.PORT || '3009', 10)
export const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/apiaberta-geo'
export const GEO_API_BASE = (process.env.GEO_API_BASE || 'https://geoapi.pt').replace(/\/$/, '')

// 04:45 Europe/Lisbon — after connector-base (03:00) and connector-gtfs (03:30).
export const SYNC_CRON = process.env.SYNC_CRON || '45 4 * * *'
export const SYNC_TZ = process.env.SYNC_TZ || 'Europe/Lisbon'
export const SYNC_REFRESH_DAYS = positiveInt(process.env.SYNC_REFRESH_DAYS, 7)
export const SYNC_STARTUP_MAX_AGE_HOURS = positiveInt(process.env.SYNC_STARTUP_MAX_AGE_HOURS, 24)
export const SYNC_CONCURRENCY = positiveInt(process.env.SYNC_CONCURRENCY, 2)
export const SYNC_FETCH_TIMEOUT_MS = positiveInt(process.env.SYNC_FETCH_TIMEOUT_MS, 60_000)
export const SYNC_PARISH_BATCH = positiveInt(process.env.SYNC_PARISH_BATCH, 200)

export const CACHE_MAX_ENTRIES = positiveInt(process.env.CACHE_MAX_ENTRIES, 250)
export const CACHE_MAX_BYTES = positiveInt(process.env.CACHE_MAX_BYTES, 1_048_576)
export const CACHE_MAX_VALUE_BYTES = positiveInt(process.env.CACHE_MAX_VALUE_BYTES, 64 * 1024)

export const TTL = {
    districts:      1 * 60 * 60 * 1000,
    municipalities: 1 * 60 * 60 * 1000,
    municipality:   24 * 60 * 60 * 1000,
    postal:         24 * 60 * 60 * 1000
}

function positiveInt(value, fallback) {
    const n = parseInt(value, 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
}

export function isLocalMongoUri(uri) {
    if (!uri) return true
    try {
        const parsed = new URL(uri)
        const host = parsed.hostname || ''
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'mongo'
    } catch {
        return /localhost|127\.0\.0\.1|::1/.test(uri)
    }
}

export function assertSafeMongoUri(uri = MONGO_URI, env = process.env.NODE_ENV) {
    if (env === 'production') return
    if (!isLocalMongoUri(uri)) {
        throw new Error(`Refusing non-local MONGO_URI in ${env || 'non-production'} (tests/dev never touch production DBs)`)
    }
}
