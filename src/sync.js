import { District } from './models/District.js'
import { Municipality } from './models/Municipality.js'
import { Parish } from './models/Parish.js'

const GEO_BASE = 'https://geoapi.pt'

function toSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function pLimit(tasks, concurrency = 5, delayMs = 50) {
  const results = []
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(batch.map(fn => fn()))
    results.push(...batchResults)
    if (i + concurrency < tasks.length) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return results
}

export async function syncDistricts() {
  console.log('[sync] Fetching districts...')
  const data = await fetchJSON(`${GEO_BASE}/distritos?json=1`)
  const docs = data.map(d => ({
    codigoine: d.codigoine || d.Dicofre || d.codigoine,
    name: d.distrito || d.Distrito,
    geojson: d.geojson || null,
    synced_at: new Date()
  })).filter(d => d.codigoine && d.name)

  for (const doc of docs) {
    await District.findOneAndUpdate(
      { codigoine: doc.codigoine },
      doc,
      { upsert: true, new: true }
    )
  }
  console.log(`[sync] Districts: ${docs.length} upserted`)
  return docs.length
}

export async function syncMunicipalities() {
  console.log('[sync] Fetching municipality list...')
  const names = await fetchJSON(`${GEO_BASE}/municipios?json=1`)
  console.log(`[sync] Got ${names.length} municipalities, fetching details...`)

  const tasks = names.map(name => async () => {
    const encoded = encodeURIComponent(name)
    const detail = await fetchJSON(`${GEO_BASE}/municipio/${encoded}?json=1`)

    // Extract coords from geojson centroid if available
    let lat = null, lng = null
    const centros = detail.geojson?.properties?.centros
    if (centros?.centroide) {
      lng = centros.centroide[0]
      lat = centros.centroide[1]
    } else if (centros?.centro) {
      lng = centros.centro[0]
      lat = centros.centro[1]
    }

    const doc = {
      codigoine:   detail.codigoine || detail.Dicofre || null,
      name:        detail.municipio || detail.Municipio || name,
      slug:        toSlug(name),
      district:    detail.distrito  || detail.Distrito  || null,
      area_ha:     detail.geojson?.properties?.Area_T_ha || null,
      email:       detail.email    || null,
      phone:       detail.telefone || null,
      website:     detail.website  || null,
      postal_code: detail.codigopostal || null,
      coords:      { lat, lng },
      geojson:     detail.geojson  || null,
      synced_at:   new Date()
    }

    await Municipality.findOneAndUpdate(
      { slug: doc.slug },
      doc,
      { upsert: true, new: true }
    )
    return doc.name
  })

  const results = await pLimit(tasks, 5, 50)
  const ok = results.filter(r => r.status === 'fulfilled').length
  const fail = results.filter(r => r.status === 'rejected').length
  console.log(`[sync] Municipalities: ${ok} ok, ${fail} failed`)
  return ok
}

export async function syncParishes() {
  console.log('[sync] Fetching parishes...')
  const data = await fetchJSON(`${GEO_BASE}/freguesias?json=1`)

  // geoapi.pt returns array of objects or plain strings
  const entries = Array.isArray(data) ? data : []
  const docs = entries.map(p => {
    if (typeof p === 'string') {
      return { name: p, municipality: null, district: null, synced_at: new Date() }
    }
    return {
      name:         p.freguesia || p.Freguesia || p.name || String(p),
      municipality: p.municipio || p.Municipio || null,
      district:     p.distrito  || p.Distrito  || null,
      synced_at:    new Date()
    }
  }).filter(p => p.name)

  // Bulk upsert
  for (const doc of docs) {
    await Parish.findOneAndUpdate(
      { name: doc.name, municipality: doc.municipality },
      doc,
      { upsert: true, new: true }
    )
  }
  console.log(`[sync] Parishes: ${docs.length} upserted`)
  return docs.length
}

export async function runSync() {
  console.log('[sync] Starting full sync...')
  const start = Date.now()
  try {
    await syncDistricts()
    await syncMunicipalities()
    await syncParishes()
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`[sync] Full sync complete in ${elapsed}s`)
  } catch (err) {
    console.error('[sync] Sync failed:', err.message)
  }
}
