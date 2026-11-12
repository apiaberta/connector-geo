export const NO_GEOJSON = Object.freeze({ geojson: 0 })

export function parseBool(value) {
    if (value === true || value === 1) return true
    if (value === false || value === 0) return false
    if (typeof value !== 'string') return null
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === '1' || v === 'yes') return true
    if (v === 'false' || v === '0' || v === 'no') return false
    return null
}

// List routes default to excluding geometry. Lookup routes default to including
// it so existing response shapes stay intact. Pass geojson=true|false to override.
export function wantsGeoJSON(query, defaultValue = false) {
    const parsed = parseBool(query?.geojson)
    return parsed === null ? defaultValue : parsed
}

export function geojsonProjection(include) {
    return include ? {} : NO_GEOJSON
}
