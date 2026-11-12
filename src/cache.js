import { CACHE_MAX_BYTES, CACHE_MAX_ENTRIES, CACHE_MAX_VALUE_BYTES } from './config.js'

export function estimateBytes(value) {
    if (value == null) return 0
    if (typeof value === 'string') return value.length * 2
    if (typeof value === 'number' || typeof value === 'boolean') return 8
    try {
        return JSON.stringify(value).length * 2
    } catch {
        return Number.MAX_SAFE_INTEGER
    }
}

export function createCache({
    maxEntries = CACHE_MAX_ENTRIES,
    maxBytes = CACHE_MAX_BYTES,
    maxValueBytes = CACHE_MAX_VALUE_BYTES
} = {}) {
    const store = new Map()
    let bytes = 0

    function drop(key) {
        const entry = store.get(key)
        if (!entry) return
        bytes -= entry.size
        store.delete(key)
    }

    function evictExpired(now = Date.now()) {
        for (const [key, entry] of store) {
            if (now > entry.expires) drop(key)
        }
    }

    function evictFor(incomingSize) {
        for (const key of store.keys()) {
            if (store.size < maxEntries && bytes + incomingSize <= maxBytes) return
            drop(key)
        }
    }

    return {
        get(key) {
            const entry = store.get(key)
            if (!entry) return null
            if (Date.now() > entry.expires) {
                drop(key)
                return null
            }
            store.delete(key)
            store.set(key, entry)
            return entry.value
        },
        set(key, value, ttl) {
            const size = estimateBytes(value)
            if (size > maxValueBytes || size > maxBytes) return false
            evictExpired()
            if (store.has(key)) drop(key)
            evictFor(size)
            if (store.size >= maxEntries || bytes + size > maxBytes) return false
            store.set(key, { value, expires: Date.now() + ttl, size })
            bytes += size
            return true
        },
        clear() {
            store.clear()
            bytes = 0
        },
        get size() {
            return store.size
        },
        get bytes() {
            return bytes
        }
    }
}

export const cache = createCache()
