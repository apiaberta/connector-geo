import 'dotenv/config'
import mongoose from 'mongoose'
import cron from 'node-cron'
import { buildApp } from './app.js'
import {
    MONGO_URI,
    PORT,
    SERVICE_NAME,
    SYNC_CRON,
    SYNC_TZ,
    assertSafeMongoUri
} from './config.js'
import { runSync, shouldSyncOnStartup } from './sync.js'

assertSafeMongoUri()

const fastify = await buildApp()

await mongoose.connect(MONGO_URI)
console.log(`[db] Connected to MongoDB: ${MONGO_URI}`)

await fastify.listen({ port: PORT, host: '0.0.0.0' })
console.log(`[server] ${SERVICE_NAME} listening on port ${PORT}`)

cron.schedule(SYNC_CRON, () => {
    console.log(`[cron] Triggering sync (${SYNC_CRON} ${SYNC_TZ})...`)
    runSync().catch(err => console.error('[cron] Sync error:', err.message))
}, { timezone: SYNC_TZ })

if (await shouldSyncOnStartup()) {
    console.log('[sync] Data missing or older than startup max age — running ingest')
    setImmediate(() => {
        runSync().catch(err => console.error('[sync] Initial sync error:', err.message))
    })
} else {
    console.log('[sync] Recent data present — skipping startup ingest')
}
