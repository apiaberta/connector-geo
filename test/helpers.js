import { assertSafeMongoUri } from '../src/config.js'

process.env.NODE_ENV = process.env.NODE_ENV || 'test'
assertSafeMongoUri(process.env.MONGO_URI || 'mongodb://localhost:27017/apiaberta-geo-test')

function valueMatches(docVal, spec) {
    if (spec instanceof RegExp) return spec.test(String(docVal ?? ''))
    if (spec && typeof spec === 'object' && !Array.isArray(spec) && !(spec instanceof Date)) {
        if (spec.$regex != null) {
            return new RegExp(spec.$regex, spec.$options || '').test(String(docVal ?? ''))
        }
        if ('$ne' in spec) return docVal !== spec.$ne
        if ('$in' in spec) return spec.$in.includes(docVal)
    }
    return docVal === spec
}

function matches(doc, filter) {
    if (!filter || Object.keys(filter).length === 0) return true
    for (const [key, spec] of Object.entries(filter)) {
        if (!valueMatches(doc[key], spec)) return false
    }
    return true
}

function project(doc, projection) {
    if (!projection || Object.keys(projection).length === 0) {
        return { ...doc }
    }
    const values = Object.values(projection)
    const excluding = values.every(v => v === 0)
    if (excluding) {
        const out = { ...doc }
        for (const key of Object.keys(projection)) delete out[key]
        return out
    }
    const out = {}
    if (!('_id' in projection)) out._id = doc._id
    for (const [key, inc] of Object.entries(projection)) {
        if (inc) out[key] = doc[key]
    }
    return out
}

function query(rows, { one = false } = {}) {
    const state = { rows: [...rows] }
    const api = {
        sort(spec = {}) {
            const key = Object.keys(spec)[0]
            if (!key) return api
            const dir = spec[key]
            state.rows.sort((a, b) => {
                if (a[key] < b[key]) return dir < 0 ? 1 : -1
                if (a[key] > b[key]) return dir < 0 ? -1 : 1
                return 0
            })
            return api
        },
        skip(n) {
            state.rows = state.rows.slice(n)
            return api
        },
        limit(n) {
            state.rows = state.rows.slice(0, n)
            return api
        },
        select() { return api },
        lean() { return api },
        then(resolve, reject) {
            const value = one ? (state.rows[0] || null) : state.rows
            return Promise.resolve(value).then(resolve, reject)
        }
    }
    return api
}

export function createMemoryModel(docs = []) {
    const store = docs.map(d => ({ ...d }))
    const model = {
        store,
        projections: [],
        find(filter = {}, projection) {
            model.projections.push(projection)
            const rows = store.filter(d => matches(d, filter)).map(d => project(d, projection))
            return query(rows)
        },
        findOne(filter = {}, projection) {
            model.projections.push(projection)
            const rows = store.filter(d => matches(d, filter)).map(d => project(d, projection))
            return query(rows, { one: true })
        },
        countDocuments(filter = {}) {
            return Promise.resolve(store.filter(d => matches(d, filter)).length)
        },
        distinct(field) {
            return Promise.resolve([...new Set(store.map(d => d[field]).filter(v => v != null && v !== ''))])
        },
        async updateOne(filter, update, options = {}) {
            const $set = update?.$set || update || {}
            const idx = store.findIndex(d => matches(d, filter))
            if (idx >= 0) {
                store[idx] = { ...store[idx], ...$set }
                return { acknowledged: true, modifiedCount: 1, upsertedCount: 0 }
            }
            if (options.upsert) {
                store.push({ ...filter, ...$set })
                return { acknowledged: true, modifiedCount: 0, upsertedCount: 1 }
            }
            return { acknowledged: true, modifiedCount: 0, upsertedCount: 0 }
        },
        async bulkWrite(ops) {
            for (const op of ops) {
                if (op.updateOne) {
                    await model.updateOne(op.updateOne.filter, op.updateOne.update, {
                        upsert: op.updateOne.upsert
                    })
                }
            }
            return { ok: 1 }
        }
    }
    return model
}

export function hugeGeoJSON(bytes = 80_000) {
    return {
        type: 'Feature',
        properties: { centros: { centroide: [-9.1, 38.7], centro: [-9.1, 38.7] }, Area_T_ha: 12 },
        geometry: {
            type: 'Polygon',
            coordinates: [[Array.from({ length: Math.ceil(bytes / 8) }, (_, i) => [i * 0.0001, i * 0.0001])]]
        }
    }
}
