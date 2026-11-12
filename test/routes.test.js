import { describe, it, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { createRoutes } from '../src/routes.js'
import { createCache } from '../src/cache.js'
import { VERSION } from '../src/config.js'
import { createMemoryModel, hugeGeoJSON } from './helpers.js'

function sampleDistrict() {
    return {
        _id: 'd1',
        codigoine: '11',
        name: 'Lisboa',
        geojson: hugeGeoJSON(2000),
        synced_at: new Date('2026-11-12T00:00:00Z')
    }
}

function sampleMunicipality() {
    return {
        _id: 'm1',
        codigoine: '1106',
        name: 'Lisboa',
        slug: 'lisboa',
        district: 'Lisboa',
        area_ha: 100,
        coords: { lat: 38.7, lng: -9.1 },
        geojson: hugeGeoJSON(2000),
        synced_at: new Date('2026-11-12T00:00:00Z')
    }
}

async function makeApp(overrides = {}) {
    const cache = overrides.cache || createCache({
        maxEntries: 50,
        maxBytes: 256_000,
        maxValueBytes: 64 * 1024
    })
    const District = overrides.District || createMemoryModel([sampleDistrict()])
    const Municipality = overrides.Municipality || createMemoryModel([sampleMunicipality()])
    const Parish = overrides.Parish || createMemoryModel([
        { name: 'Marvila', municipality: 'Lisboa', district: 'Lisboa' }
    ])
    const fetchImpl = overrides.fetchImpl || (async () => ({
        ok: true,
        async json() { return { CP: '1000-001', localidade: 'Lisboa' } }
    }))
    const app = await buildApp({
        logger: false,
        routes: createRoutes({ cache, District, Municipality, Parish, fetchImpl })
    })
    return { app, cache, District, Municipality, Parish }
}

describe('HTTP routes', () => {
    let ctx

    beforeEach(async () => {
        if (ctx?.app) await ctx.app.close()
        ctx = await makeApp()
    })

    after(async () => {
        if (ctx?.app) await ctx.app.close()
    })

    it('GET /health reports the package version', async () => {
        const res = await ctx.app.inject({ method: 'GET', url: '/health' })
        assert.equal(res.statusCode, 200)
        assert.deepEqual(res.json(), {
            status: 'ok',
            service: 'connector-geo',
            version: VERSION
        })
        assert.match(VERSION, /^1\.1\./)
    })

    it('GET /geo/health', async () => {
        const res = await ctx.app.inject({ method: 'GET', url: '/geo/health' })
        assert.equal(res.statusCode, 200)
        assert.equal(res.json().status, 'ok')
    })

    it('GET /geo/districts omits geojson unless asked', async () => {
        const res = await ctx.app.inject({ method: 'GET', url: '/geo/districts' })
        assert.equal(res.statusCode, 200)
        const body = res.json()
        assert.equal(body.count, 1)
        assert.equal(body.data[0].name, 'Lisboa')
        assert.equal('geojson' in body.data[0], false)
        assert.ok(ctx.District.projections.some(p => p && p.geojson === 0))

        const withGeo = await ctx.app.inject({ method: 'GET', url: '/geo/districts?geojson=true' })
        assert.equal(withGeo.statusCode, 200)
        assert.ok(withGeo.json().data[0].geojson)
        assert.equal(ctx.cache.get('districts:true'), null)
    })

    it('GET /geo/districts/:id keeps geojson by default and drops it when asked', async () => {
        const res = await ctx.app.inject({ method: 'GET', url: '/geo/districts/11' })
        assert.equal(res.statusCode, 200)
        assert.equal(res.json().codigoine, '11')
        assert.ok(res.json().geojson)
        assert.equal(ctx.cache.get('district:11:true'), null)

        const slim = await ctx.app.inject({ method: 'GET', url: '/geo/districts/11?geojson=false' })
        assert.equal('geojson' in slim.json(), false)
        assert.ok(ctx.cache.get('district:11:false'))
    })

    it('GET /geo/municipalities list never loads geometry by default', async () => {
        const res = await ctx.app.inject({ method: 'GET', url: '/geo/municipalities' })
        assert.equal(res.statusCode, 200)
        const body = res.json()
        assert.equal(body.total, 1)
        assert.equal(body.page, 1)
        assert.equal(body.limit, 50)
        assert.equal(body.data[0].slug, 'lisboa')
        assert.equal('geojson' in body.data[0], false)
    })

    it('GET /geo/municipalities/:slug keeps the previous response shape (geojson included)', async () => {
        const res = await ctx.app.inject({ method: 'GET', url: '/geo/municipalities/lisboa' })
        assert.equal(res.statusCode, 200)
        const body = res.json()
        assert.equal(body.slug, 'lisboa')
        assert.ok(body.geojson)
        assert.equal(body.district, 'Lisboa')
        assert.equal(ctx.cache.get('municipality:lisboa:true'), null)
    })

    it('GET /geo/municipalities/:slug/parishes does not load municipality geometry', async () => {
        const res = await ctx.app.inject({ method: 'GET', url: '/geo/municipalities/lisboa/parishes' })
        assert.equal(res.statusCode, 200)
        const body = res.json()
        assert.equal(body.municipality, 'Lisboa')
        assert.equal(body.count, 1)
        assert.equal(body.data[0].name, 'Marvila')
        const parishLookup = ctx.Municipality.projections.find(p => p && p.name === 1)
        assert.ok(parishLookup)
        assert.equal(parishLookup.geojson, undefined)
    })

    it('GET /geo/parishes keeps { count, data } with name/municipality/district', async () => {
        const res = await ctx.app.inject({ method: 'GET', url: '/geo/parishes' })
        assert.equal(res.statusCode, 200)
        assert.deepEqual(res.json(), {
            count: 1,
            data: [{ name: 'Marvila', municipality: 'Lisboa', district: 'Lisboa' }]
        })
    })

    it('GET /geo/meta does not load geojson', async () => {
        const res = await ctx.app.inject({ method: 'GET', url: '/geo/meta' })
        assert.equal(res.statusCode, 200)
        const body = res.json()
        assert.equal(body.districts, 1)
        assert.equal(body.municipalities, 1)
        assert.equal(body.parishes, 1)
        assert.ok(body.last_sync)
        assert.ok(ctx.District.projections.some(p => p && p.synced_at === 1))
    })

    it('GET /geo/postal/:code validates and caches small payloads', async () => {
        const bad = await ctx.app.inject({ method: 'GET', url: '/geo/postal/1000' })
        assert.equal(bad.statusCode, 400)

        const ok = await ctx.app.inject({ method: 'GET', url: '/geo/postal/1000-001' })
        assert.equal(ok.statusCode, 200)
        assert.equal(ok.json().CP, '1000-001')
        assert.ok(ctx.cache.get('postal:1000-001'))
    })

    it('returns 404 for unknown district and municipality', async () => {
        const d = await ctx.app.inject({ method: 'GET', url: '/geo/districts/99' })
        assert.equal(d.statusCode, 404)
        const m = await ctx.app.inject({ method: 'GET', url: '/geo/municipalities/nope' })
        assert.equal(m.statusCode, 404)
    })
})
