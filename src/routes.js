import { District as DistrictModel } from './models/District.js'
import { Municipality as MunicipalityModel } from './models/Municipality.js'
import { Parish as ParishModel } from './models/Parish.js'
import { cache as defaultCache } from './cache.js'
import { GEO_API_BASE, TTL } from './config.js'
import { geojsonProjection, wantsGeoJSON } from './projections.js'

export function createRoutes({
    cache = defaultCache,
    District = DistrictModel,
    Municipality = MunicipalityModel,
    Parish = ParishModel,
    fetchImpl = fetch,
    geoBase = GEO_API_BASE
} = {}) {
    return async function routes(fastify) {
        fastify.get('/health', async () => ({ status: 'ok', service: 'connector-geo' }))

        fastify.get('/meta', async () => {
            const [districts, municipalities, parishes] = await Promise.all([
                District.countDocuments(),
                Municipality.countDocuments(),
                Parish.countDocuments()
            ])
            const lastDistrict = await District.findOne({}, { synced_at: 1 }).sort({ synced_at: -1 }).lean()
            return {
                districts,
                municipalities,
                parishes,
                last_sync: lastDistrict?.synced_at || null
            }
        })

        fastify.get('/districts', async (req) => {
            const includeGeoJSON = wantsGeoJSON(req.query, false)
            const cacheKey = `districts:${includeGeoJSON}`
            if (!includeGeoJSON) {
                const cached = cache.get(cacheKey)
                if (cached) return cached
            }

            const docs = await District.find({}, geojsonProjection(includeGeoJSON)).sort({ name: 1 }).lean()
            const result = { count: docs.length, data: docs }
            if (!includeGeoJSON) cache.set(cacheKey, result, TTL.districts)
            return result
        })

        fastify.get('/districts/:id', async (req, reply) => {
            const includeGeoJSON = wantsGeoJSON(req.query, true)
            const cacheKey = `district:${req.params.id}:${includeGeoJSON}`
            if (!includeGeoJSON) {
                const cached = cache.get(cacheKey)
                if (cached) return cached
            }

            const doc = await District.findOne(
                { codigoine: req.params.id },
                geojsonProjection(includeGeoJSON)
            ).lean()
            if (!doc) return reply.code(404).send({ error: 'District not found' })
            if (!includeGeoJSON) cache.set(cacheKey, doc, TTL.districts)
            return doc
        })

        fastify.get('/municipalities', async (req) => {
            const { district, page = 1, limit = 50 } = req.query
            const includeGeoJSON = wantsGeoJSON(req.query, false)
            const pageN = parseInt(page, 10)
            const limitN = parseInt(limit, 10)
            const cacheKey = `municipalities:${district || ''}:${pageN}:${limitN}:${includeGeoJSON}`
            if (!includeGeoJSON) {
                const cached = cache.get(cacheKey)
                if (cached) return cached
            }

            const filter = district ? { district: new RegExp(district, 'i') } : {}
            const skip = (pageN - 1) * limitN
            const [docs, total] = await Promise.all([
                Municipality.find(filter, geojsonProjection(includeGeoJSON))
                    .sort({ name: 1 })
                    .skip(skip)
                    .limit(limitN)
                    .lean(),
                Municipality.countDocuments(filter)
            ])
            const result = {
                total,
                page: pageN,
                limit: limitN,
                pages: Math.ceil(total / limitN),
                data: docs
            }
            if (!includeGeoJSON) cache.set(cacheKey, result, TTL.municipalities)
            return result
        })

        fastify.get('/municipalities/:slug', async (req, reply) => {
            const includeGeoJSON = wantsGeoJSON(req.query, true)
            const cacheKey = `municipality:${req.params.slug}:${includeGeoJSON}`
            if (!includeGeoJSON) {
                const cached = cache.get(cacheKey)
                if (cached) return cached
            }

            const doc = await Municipality.findOne(
                { slug: req.params.slug },
                geojsonProjection(includeGeoJSON)
            ).lean()
            if (!doc) return reply.code(404).send({ error: 'Municipality not found' })
            if (!includeGeoJSON) cache.set(cacheKey, doc, TTL.municipality)
            return doc
        })

        fastify.get('/municipalities/:slug/parishes', async (req, reply) => {
            const muni = await Municipality.findOne(
                { slug: req.params.slug },
                { name: 1 }
            ).lean()
            if (!muni) return reply.code(404).send({ error: 'Municipality not found' })

            const parishes = await Parish.find(
                { municipality: new RegExp(`^${muni.name}$`, 'i') },
                { _id: 0, name: 1, district: 1 }
            ).sort({ name: 1 }).lean()

            return { municipality: muni.name, count: parishes.length, data: parishes }
        })

        fastify.get('/parishes', async (req) => {
            const { municipality } = req.query
            const filter = municipality ? { municipality: new RegExp(municipality, 'i') } : {}
            const docs = await Parish.find(filter, { _id: 0, name: 1, municipality: 1, district: 1 })
                .sort({ name: 1 })
                .lean()
            return { count: docs.length, data: docs }
        })

        fastify.get('/postal/:code', async (req, reply) => {
            const { code } = req.params
            if (!/^\d{4}-\d{3}$/.test(code)) {
                return reply.code(400).send({ error: 'Invalid postal code format. Use XXXX-XXX' })
            }

            const cacheKey = `postal:${code}`
            const cached = cache.get(cacheKey)
            if (cached) return cached

            try {
                const res = await fetchImpl(`${geoBase}/cp/${encodeURIComponent(code)}?json=1`)
                if (!res.ok) return reply.code(404).send({ error: 'Postal code not found' })
                const data = await res.json()
                cache.set(cacheKey, data, TTL.postal)
                return data
            } catch {
                return reply.code(502).send({ error: 'Failed to fetch postal code data' })
            }
        })
    }
}

export const routes = createRoutes()
