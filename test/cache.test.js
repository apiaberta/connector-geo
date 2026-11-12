import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCache, estimateBytes } from '../src/cache.js'
import { hugeGeoJSON } from './helpers.js'

describe('bounded cache', () => {
    it('returns null for missing and expired keys', async () => {
        const cache = createCache({ maxEntries: 10, maxBytes: 10_000, maxValueBytes: 5_000 })
        assert.equal(cache.get('missing'), null)
        cache.set('a', { ok: true }, 5)
        assert.deepEqual(cache.get('a'), { ok: true })
        await new Promise(r => setTimeout(r, 10))
        assert.equal(cache.get('a'), null)
    })

    it('evicts oldest entries when maxEntries is exceeded', () => {
        const cache = createCache({ maxEntries: 2, maxBytes: 10_000, maxValueBytes: 5_000 })
        assert.equal(cache.set('a', { n: 1 }, 60_000), true)
        assert.equal(cache.set('b', { n: 2 }, 60_000), true)
        assert.equal(cache.set('c', { n: 3 }, 60_000), true)
        assert.equal(cache.get('a'), null)
        assert.deepEqual(cache.get('b'), { n: 2 })
        assert.deepEqual(cache.get('c'), { n: 3 })
        assert.equal(cache.size, 2)
    })

    it('refuses values larger than maxValueBytes (GeoJSON payloads)', () => {
        const cache = createCache({ maxEntries: 50, maxBytes: 1_000_000, maxValueBytes: 64 * 1024 })
        const bulky = { count: 1, data: [{ geojson: hugeGeoJSON(80_000) }] }
        assert.ok(estimateBytes(bulky) > 64 * 1024)
        assert.equal(cache.set('districts:true', bulky, 60_000), false)
        assert.equal(cache.get('districts:true'), null)
        assert.equal(cache.set('districts:false', { count: 1, data: [{ name: 'Lisboa' }] }, 60_000), true)
    })

    it('clears all entries', () => {
        const cache = createCache({ maxEntries: 10, maxBytes: 10_000, maxValueBytes: 5_000 })
        cache.set('a', { n: 1 }, 60_000)
        cache.clear()
        assert.equal(cache.size, 0)
        assert.equal(cache.get('a'), null)
    })
})
