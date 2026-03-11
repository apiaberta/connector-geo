import 'dotenv/config'
import Fastify from 'fastify'
import mongoose from 'mongoose'
import cron from 'node-cron'
import { routes } from './routes.js'
import { runSync } from './sync.js'

const PORT     = parseInt(process.env.PORT || '3009')
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/apiaberta-geo'

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info'
  }
})

// Register routes
fastify.register(routes)

async function start() {
  // Connect to MongoDB
  await mongoose.connect(MONGO_URI)
  console.log(`[db] Connected to MongoDB: ${MONGO_URI}`)

  // Start HTTP server
  await fastify.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[server] connector-geo listening on port ${PORT}`)

  // Initial sync (non-blocking)
  setImmediate(() => {
    runSync().catch(err => console.error('[sync] Initial sync error:', err.message))
  })

  // Daily sync at 03:30
  cron.schedule('30 3 * * *', () => {
    console.log('[cron] Triggering daily sync...')
    runSync().catch(err => console.error('[cron] Sync error:', err.message))
  })
}

start().catch(err => {
  console.error('[startup] Fatal error:', err)
  process.exit(1)
})
