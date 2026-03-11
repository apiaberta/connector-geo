import { District } from './models/District.js'
import { Municipality } from './models/Municipality.js'
import { Parish } from './models/Parish.js'

// Simple in-memory cache
const cache = new Map()
const TTL = {
  districts:    1 * 60 * 60 * 1000,   // 1h
  municipalities: 1 * 60 * 60 * 1000, // 1h
  municipality: 24 * 60 * 60 * 1000,  // 24h
  postal:       24 * 60 * 60 * 1000   // 24h
}

function cacheGet(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function cacheSet(key, value, ttl) {
  cache.set(key, { value, expires: Date.now() + ttl })
}

export async function routes(fastify) {
  // Health
  fastify.get('/health', async () => ({ status: 'ok', service: 'connector-geo' }))

  // Meta / stats
  fastify.get('/meta', async () => {
    const [districts, municipalities, parishes] = await Promise.all([
      District.countDocuments(),
      Municipality.countDocuments(),
      Parish.countDocuments()
    ])
    const lastDistrict = await District.findOne().sort({ synced_at: -1 }).select('synced_at')
    return {
      districts,
      municipalities,
      parishes,
      last_sync: lastDistrict?.synced_at || null
    }
  })

  // Districts list
  fastify.get('/districts', async (req) => {
    const includeGeoJSON = req.query.geojson === 'true'
    const cacheKey = `districts:${includeGeoJSON}`
    const cached = cacheGet(cacheKey)
    if (cached) return cached

    const projection = includeGeoJSON ? {} : { geojson: 0 }
    const docs = await District.find({}, projection).sort({ name: 1 }).lean()
    const result = { count: docs.length, data: docs }
    cacheSet(cacheKey, result, TTL.districts)
    return result
  })

  // District by codigoine
  fastify.get('/districts/:id', async (req, reply) => {
    const doc = await District.findOne({ codigoine: req.params.id }).lean()
    if (!doc) return reply.code(404).send({ error: 'District not found' })
    return doc
  })

  // Municipalities list
  fastify.get('/municipalities', async (req) => {
    const { district, page = 1, limit = 50 } = req.query
    const cacheKey = `municipalities:${district || ''}:${page}:${limit}`
    const cached = cacheGet(cacheKey)
    if (cached) return cached

    const filter = district ? { district: new RegExp(district, 'i') } : {}
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [docs, total] = await Promise.all([
      Municipality.find(filter, { geojson: 0 })
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Municipality.countDocuments(filter)
    ])
    const result = {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      data: docs
    }
    cacheSet(cacheKey, result, TTL.municipalities)
    return result
  })

  // Municipality by slug
  fastify.get('/municipalities/:slug', async (req, reply) => {
    const cacheKey = `municipality:${req.params.slug}`
    const cached = cacheGet(cacheKey)
    if (cached) return cached

    const doc = await Municipality.findOne({ slug: req.params.slug }).lean()
    if (!doc) return reply.code(404).send({ error: 'Municipality not found' })
    cacheSet(cacheKey, doc, TTL.municipality)
    return doc
  })

  // Parishes of a municipality
  fastify.get('/municipalities/:slug/parishes', async (req, reply) => {
    const muni = await Municipality.findOne({ slug: req.params.slug }).lean()
    if (!muni) return reply.code(404).send({ error: 'Municipality not found' })

    const parishes = await Parish.find(
      { municipality: new RegExp(`^${muni.name}$`, 'i') },
      { _id: 0, name: 1, district: 1 }
    ).sort({ name: 1 }).lean()

    return { municipality: muni.name, count: parishes.length, data: parishes }
  })

  // Parishes list
  fastify.get('/parishes', async (req) => {
    const { municipality } = req.query
    const filter = municipality ? { municipality: new RegExp(municipality, 'i') } : {}
    const docs = await Parish.find(filter, { _id: 0, name: 1, municipality: 1, district: 1 })
      .sort({ name: 1 })
      .lean()
    return { count: docs.length, data: docs }
  })

  // Postal code lookup (proxy + cache)
  fastify.get('/postal/:code', async (req, reply) => {
    const { code } = req.params
    if (!/^\d{4}-\d{3}$/.test(code)) {
      return reply.code(400).send({ error: 'Invalid postal code format. Use XXXX-XXX' })
    }

    const cacheKey = `postal:${code}`
    const cached = cacheGet(cacheKey)
    if (cached) return cached

    try {
      const res = await fetch(`https://geoapi.pt/cp/${encodeURIComponent(code)}?json=1`)
      if (!res.ok) return reply.code(404).send({ error: 'Postal code not found' })
      const data = await res.json()
      cacheSet(cacheKey, data, TTL.postal)
      return data
    } catch {
      return reply.code(502).send({ error: 'Failed to fetch postal code data' })
    }
  })
}
