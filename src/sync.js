import { District } from './models/District.js'
import { Municipality } from './models/Municipality.js'
import { Parish } from './models/Parish.js'
import { cache } from './cache.js'
import { DISTRICT_CATALOG } from './districts.js'
import {
    GEO_API_BASE,
    SYNC_CONCURRENCY,
    SYNC_FETCH_TIMEOUT_MS,
    SYNC_PARISH_BATCH,
    SYNC_REFRESH_DAYS,
    SYNC_STARTUP_MAX_AGE_HOURS
} from './config.js'

export function toSlug(name) {
    return String(name)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
}

export function extractCoords(geojson) {
    const centros = geojson?.properties?.centros
    if (centros?.centroide) {
        return { lng: centros.centroide[0], lat: centros.centroide[1] }
    }
    if (centros?.centro) {
        return { lng: centros.centro[0], lat: centros.centro[1] }
    }
    return { lat: null, lng: null }
}

export function parseParishEntry(entry, syncedAt) {
    if (typeof entry === 'string') {
        return { name: entry, municipality: null, district: null, synced_at: syncedAt }
    }
    if (!entry || typeof entry !== 'object') return null
    const name = entry.freguesia || entry.Freguesia || entry.name || null
    if (!name) return null
    return {
        name,
        municipality: entry.municipio || entry.Municipio || null,
        district:     entry.distrito || entry.Distrito || null,
        synced_at:    syncedAt
    }
}

export function isFresh(syncedAt, cutoff) {
    if (!syncedAt) return false
    const t = syncedAt instanceof Date ? syncedAt.getTime() : Date.parse(syncedAt)
    return Number.isFinite(t) && t >= cutoff.getTime()
}

export async function mapLimit(items, concurrency, fn) {
    const results = new Array(items.length)
    let next = 0
    const workers = Math.max(1, Math.min(concurrency, items.length || 1))

    async function worker() {
        while (true) {
            const i = next++
            if (i >= items.length) return
            try {
                results[i] = { status: 'fulfilled', value: await fn(items[i], i) }
            } catch (reason) {
                results[i] = { status: 'rejected', reason }
            }
        }
    }

    if (items.length === 0) return []
    await Promise.all(Array.from({ length: workers }, worker))
    return results
}

export async function fetchJSON(url, { timeoutMs = SYNC_FETCH_TIMEOUT_MS, fetchImpl = fetch } = {}) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.json()
}

function assertNotBulkDistrictsDump(url) {
    // GET /distritos and /distritos/municipios are ~17 MiB GeoJSON dumps.
    const path = String(url).replace(/[?#].*$/, '')
    if (/\/distritos\/?$/.test(path) || /\/distritos\/municipios\/?$/.test(path)) {
        throw new Error(`Refusing bulk GeoJSON dump: ${url}`)
    }
}

function refreshCutoff(now, refreshDays) {
    return new Date(now.getTime() - refreshDays * 24 * 60 * 60 * 1000)
}

function deps(overrides = {}) {
    return {
        District:     overrides.District || District,
        Municipality: overrides.Municipality || Municipality,
        Parish:       overrides.Parish || Parish,
        fetchJSON:    async (url, opts) => {
            assertNotBulkDistrictsDump(url)
            const get = overrides.fetchJSON || fetchJSON
            return get(url, opts)
        },
        now:          overrides.now || new Date(),
        full:         Boolean(overrides.full),
        refreshDays:  overrides.refreshDays ?? SYNC_REFRESH_DAYS,
        concurrency:  overrides.concurrency ?? SYNC_CONCURRENCY,
        parishBatch:  overrides.parishBatch ?? SYNC_PARISH_BATCH,
        geoBase:      overrides.geoBase || GEO_API_BASE
    }
}

export async function syncDistricts(overrides = {}) {
    const { District: Dist, Municipality: Muni, fetchJSON: get, now, full, refreshDays, geoBase } = deps(overrides)
    console.log('[sync] Syncing districts (one GeoJSON at a time)...')
    const cutoff = refreshCutoff(now, refreshDays)

    const [existing, fromMunicipalities] = await Promise.all([
        Dist.find({}, { name: 1, codigoine: 1, synced_at: 1 }).lean(),
        Muni.distinct('district').catch(() => [])
    ])

    const byName = new Map()
    for (const row of DISTRICT_CATALOG) {
        byName.set(row.name.toLowerCase(), { name: row.name, codigoine: row.codigoine })
    }
    for (const row of existing) {
        if (!row.name) continue
        const key = row.name.toLowerCase()
        const prev = byName.get(key) || { name: row.name }
        byName.set(key, {
            name: row.name,
            codigoine: row.codigoine || prev.codigoine || null,
            synced_at: row.synced_at
        })
    }
    for (const name of fromMunicipalities) {
        if (!name) continue
        const key = String(name).toLowerCase()
        if (!byName.has(key)) byName.set(key, { name: String(name), codigoine: null })
    }

    let upserted = 0
    let skipped = 0
    let failed = 0

    for (const item of byName.values()) {
        if (!full && isFresh(item.synced_at, cutoff)) {
            skipped++
            continue
        }
        const url = `${geoBase}/distrito/${encodeURIComponent(item.name)}?json=1`
        try {
            const detail = await get(url)
            const codigoine = String(detail.codigoine || detail.Dicofre || item.codigoine || '')
            const name = detail.distrito || detail.Distrito || item.name
            if (!codigoine || !name) {
                failed++
                continue
            }
            const $set = {
                codigoine,
                name,
                synced_at: now
            }
            if (detail.geojson) $set.geojson = detail.geojson
            await Dist.updateOne({ codigoine }, { $set }, { upsert: true })
            upserted++
        } catch (err) {
            failed++
            console.error(`[sync] District "${item.name}" failed:`, err.message)
        }
    }

    console.log(`[sync] Districts: ${upserted} upserted, ${skipped} skipped, ${failed} failed`)
    return { upserted, skipped, failed }
}

export async function syncMunicipalities(overrides = {}) {
    const {
        Municipality: Muni, fetchJSON: get, now, full, refreshDays, concurrency, geoBase
    } = deps(overrides)

    console.log('[sync] Fetching municipality list...')
    const names = await get(`${geoBase}/municipios?json=1`)
    const list = Array.isArray(names) ? names.filter(n => typeof n === 'string' && n) : []
    console.log(`[sync] Got ${list.length} municipalities`)

    const existing = await Muni.find({}, { slug: 1, synced_at: 1 }).lean()
    const bySlug = new Map(existing.map(d => [d.slug, d]))
    const cutoff = refreshCutoff(now, refreshDays)

    const targets = []
    let skipped = 0
    for (const name of list) {
        const slug = toSlug(name)
        const prev = bySlug.get(slug)
        if (!full && isFresh(prev?.synced_at, cutoff)) {
            skipped++
            continue
        }
        targets.push(name)
    }

    const results = await mapLimit(targets, concurrency, async (name) => {
        const encoded = encodeURIComponent(name)
        const detail = await get(`${geoBase}/municipio/${encoded}?json=1`)
        const coords = extractCoords(detail.geojson)
        const slug = toSlug(name)
        const $set = {
            codigoine:   detail.codigoine != null ? String(detail.codigoine) : (detail.Dicofre != null ? String(detail.Dicofre) : null),
            name:        detail.municipio || detail.Municipio || name,
            slug,
            district:    detail.distrito || detail.Distrito || null,
            area_ha:     detail.geojson?.properties?.Area_T_ha || detail.areaha || null,
            email:       detail.email || null,
            phone:       detail.telefone || null,
            website:     detail.website || detail.sitio || null,
            postal_code: detail.codigopostal || null,
            coords,
            synced_at:   now
        }
        if (detail.geojson) $set.geojson = detail.geojson
        await Muni.updateOne({ slug }, { $set }, { upsert: true })
        return slug
    })

    const upserted = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length
    for (const r of results) {
        if (r.status === 'rejected') {
            console.error('[sync] Municipality failed:', r.reason?.message || r.reason)
        }
    }
    console.log(`[sync] Municipalities: ${upserted} upserted, ${skipped} skipped, ${failed} failed`)
    return { upserted, skipped, failed, total: list.length }
}

export async function syncParishes(overrides = {}) {
    const { Parish: Par, fetchJSON: get, now, parishBatch, geoBase } = deps(overrides)
    console.log('[sync] Fetching parishes...')
    const data = await get(`${geoBase}/freguesias?json=1`)
    const entries = Array.isArray(data) ? data : []
    const docs = entries.map(p => parseParishEntry(p, now)).filter(Boolean)

    let upserted = 0
    for (let i = 0; i < docs.length; i += parishBatch) {
        const batch = docs.slice(i, i + parishBatch)
        const ops = batch.map(doc => ({
            updateOne: {
                filter: { name: doc.name, municipality: doc.municipality },
                update: { $set: doc },
                upsert: true
            }
        }))
        if (ops.length) {
            await Par.bulkWrite(ops, { ordered: false })
            upserted += ops.length
        }
    }

    console.log(`[sync] Parishes: ${upserted} upserted`)
    return { upserted }
}

let inflight = null

export async function runSync(overrides = {}) {
    if (inflight) {
        console.log('[sync] Already running — skip')
        return { skipped: true }
    }
    inflight = (async () => {
        console.log('[sync] Starting sync...')
        const start = Date.now()
        const full = Boolean(overrides.full || process.env.SYNC_FULL === '1')
        try {
            const districts = await syncDistricts({ ...overrides, full })
            const municipalities = await syncMunicipalities({ ...overrides, full })
            const parishes = await syncParishes({ ...overrides, full })
            cache.clear()
            const elapsed = ((Date.now() - start) / 1000).toFixed(1)
            console.log(`[sync] Sync complete in ${elapsed}s`)
            return { districts, municipalities, parishes, elapsed: Number(elapsed), full }
        } catch (err) {
            console.error('[sync] Sync failed:', err.message)
            throw err
        }
    })().finally(() => {
        inflight = null
    })
    return inflight
}

export async function shouldSyncOnStartup(overrides = {}) {
    const force = process.env.SYNC_ON_STARTUP
    if (force === '1' || force === 'true') return true
    if (force === '0' || force === 'false') return false

    const { District: Dist, now } = deps(overrides)
    const last = await Dist.findOne({}, { synced_at: 1 }).sort({ synced_at: -1 }).lean()
    if (!last?.synced_at) return true
    const maxAgeMs = (overrides.startupMaxAgeHours ?? SYNC_STARTUP_MAX_AGE_HOURS) * 3600 * 1000
    const age = now.getTime() - new Date(last.synced_at).getTime()
    return age >= maxAgeMs
}
