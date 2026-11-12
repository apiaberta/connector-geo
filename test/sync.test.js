import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DISTRICT_CATALOG } from '../src/districts.js'
import {
    extractCoords,
    isFresh,
    mapLimit,
    parseParishEntry,
    shouldSyncOnStartup,
    syncDistricts,
    syncMunicipalities,
    syncParishes,
    toSlug
} from '../src/sync.js'
import { createMemoryModel, hugeGeoJSON } from './helpers.js'
import { cache } from '../src/cache.js'

describe('sync helpers', () => {
    it('toSlug strips diacritics', () => {
        assert.equal(toSlug('Évora'), 'evora')
        assert.equal(toSlug('Viana do Castelo'), 'viana-do-castelo')
    })

    it('extractCoords prefers centroide', () => {
        assert.deepEqual(extractCoords({
            properties: { centros: { centroide: [-9.15, 38.72], centro: [0, 0] } }
        }), { lng: -9.15, lat: 38.72 })
        assert.deepEqual(extractCoords(null), { lat: null, lng: null })
    })

    it('parseParishEntry keeps string shape used by the public API', () => {
        const at = new Date('2026-11-12T00:00:00Z')
        assert.deepEqual(parseParishEntry('Marvila (Lisboa)', at), {
            name: 'Marvila (Lisboa)',
            municipality: null,
            district: null,
            synced_at: at
        })
        assert.equal(parseParishEntry({ Freguesia: 'Sé', Municipio: 'Faro', Distrito: 'Faro' }, at).municipality, 'Faro')
    })

    it('isFresh compares against the refresh cutoff', () => {
        const cutoff = new Date('2026-11-05T00:00:00Z')
        assert.equal(isFresh(new Date('2026-11-10T00:00:00Z'), cutoff), true)
        assert.equal(isFresh(new Date('2026-11-01T00:00:00Z'), cutoff), false)
        assert.equal(isFresh(null, cutoff), false)
    })

    it('mapLimit caps concurrency', async () => {
        let current = 0
        let peak = 0
        const items = [1, 2, 3, 4, 5]
        const results = await mapLimit(items, 2, async (n) => {
            current++
            peak = Math.max(peak, current)
            await new Promise(r => setTimeout(r, 5))
            current--
            return n * 2
        })
        assert.equal(peak, 2)
        assert.deepEqual(results.map(r => r.value), [2, 4, 6, 8, 10])
    })
})

describe('district catalog', () => {
    it('covers the 29 CAOP districts/islands geoapi.pt returns', () => {
        assert.equal(DISTRICT_CATALOG.length, 29)
        assert.ok(DISTRICT_CATALOG.find(d => d.name === 'Lisboa' && d.codigoine === '11'))
        assert.ok(DISTRICT_CATALOG.find(d => d.name === 'Ilha de São Miguel'))
    })
})

describe('syncDistricts', () => {
    it('never hits GET /distritos and skips fresh rows', async () => {
        const now = new Date('2026-11-12T04:45:00Z')
        const District = createMemoryModel([
            { codigoine: '11', name: 'Lisboa', synced_at: new Date('2026-11-11T00:00:00Z'), geojson: { keep: true } }
        ])
        const Municipality = createMemoryModel([])
        const urls = []
        const fetchJSON = async (url) => {
            urls.push(url)
            if (url.includes('/distritos')) throw new Error(`unexpected bulk URL ${url}`)
            return {
                codigoine: '08',
                distrito: 'Faro',
                geojson: hugeGeoJSON(1000)
            }
        }

        const r = await syncDistricts({
            District,
            Municipality,
            fetchJSON,
            now,
            refreshDays: 7,
            full: false
        })

        assert.equal(r.skipped >= 1, true)
        assert.equal(urls.some(u => /\/distritos(\/municipios)?(\?|$)/.test(u)), false)
        assert.ok(urls.every(u => /\/distrito\//.test(u)))
        assert.equal(District.store.find(d => d.codigoine === '11').geojson.keep, true)
        const faro = District.store.find(d => d.name === 'Faro')
        assert.ok(faro)
        assert.ok(faro.geojson)
    })

    it('refetches when full: true', async () => {
        const now = new Date('2026-11-12T04:45:00Z')
        const District = createMemoryModel([
            { codigoine: '11', name: 'Lisboa', synced_at: now, geojson: { old: true } }
        ])
        const Municipality = createMemoryModel([])
        const fetchJSON = async (url) => {
            if (!url.includes('Lisboa')) {
                return { codigoine: '99', distrito: 'SkipMe' }
            }
            return { codigoine: '11', distrito: 'Lisboa', geojson: { new: true } }
        }
        await syncDistricts({
            District,
            Municipality,
            fetchJSON,
            now,
            full: true,
            refreshDays: 7
        })
        assert.deepEqual(District.store.find(d => d.codigoine === '11').geojson, { new: true })
    })
})

describe('syncMunicipalities', () => {
    it('skips fresh municipalities and does not keep the name list as GeoJSON', async () => {
        const now = new Date('2026-11-12T04:45:00Z')
        const Municipality = createMemoryModel([
            { slug: 'lisboa', name: 'Lisboa', synced_at: new Date('2026-11-10T00:00:00Z') }
        ])
        const fetched = []
        const fetchJSON = async (url) => {
            fetched.push(url)
            if (url.endsWith('/municipios?json=1')) return ['Lisboa', 'Faro']
            if (url.includes('/municipio/Faro')) {
                return {
                    codigoine: 8,
                    municipio: 'Faro',
                    distrito: 'Faro',
                    geojson: hugeGeoJSON(500)
                }
            }
            throw new Error(`should skip Lisboa, got ${url}`)
        }
        const r = await syncMunicipalities({
            Municipality,
            fetchJSON,
            now,
            refreshDays: 7,
            concurrency: 1
        })
        assert.equal(r.skipped, 1)
        assert.equal(r.upserted, 1)
        assert.equal(Municipality.store.find(d => d.slug === 'faro').district, 'Faro')
        assert.equal(Municipality.projections.some(p => p && 'slug' in p && !('geojson' in p && p.geojson === 1)), true)
    })
})

describe('syncParishes', () => {
    it('bulk-upserts in batches without findOneAndUpdate', async () => {
        const Parish = createMemoryModel([])
        let writes = 0
        const orig = Parish.bulkWrite.bind(Parish)
        Parish.bulkWrite = async (ops, opts) => {
            writes++
            assert.equal(opts.ordered, false)
            return orig(ops, opts)
        }
        const r = await syncParishes({
            Parish,
            now: new Date('2026-11-12T00:00:00Z'),
            parishBatch: 2,
            fetchJSON: async () => ['A (X)', 'B (Y)', 'C (Z)']
        })
        assert.equal(r.upserted, 3)
        assert.equal(writes, 2)
        assert.equal(Parish.store.length, 3)
        assert.equal(Parish.findOneAndUpdate, undefined)
    })
})

describe('shouldSyncOnStartup', () => {
    it('runs when the collection is empty', async () => {
        const District = createMemoryModel([])
        assert.equal(await shouldSyncOnStartup({ District, now: new Date() }), true)
    })

    it('skips when last sync is within the max age', async () => {
        const now = new Date('2026-11-12T21:35:00Z')
        const District = createMemoryModel([
            { codigoine: '11', name: 'Lisboa', synced_at: new Date('2026-11-12T12:00:00Z') }
        ])
        assert.equal(await shouldSyncOnStartup({
            District,
            now,
            startupMaxAgeHours: 24
        }), false)
    })
})

describe('cache after helpers', () => {
    it('exports a singleton cache that can be cleared', () => {
        cache.set('k', { v: 1 }, 60_000)
        cache.clear()
        assert.equal(cache.get('k'), null)
    })
})
