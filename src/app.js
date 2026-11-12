import Fastify from 'fastify'
import { SERVICE_NAME, VERSION } from './config.js'
import { routes as defaultRoutes } from './routes.js'

export async function buildApp({ logger, routes = defaultRoutes } = {}) {
    const fastify = Fastify({
        logger: logger === undefined
            ? { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' }
            : logger
    })

    fastify.get('/health', async () => ({
        status: 'ok',
        service: SERVICE_NAME,
        version: VERSION
    }))

    await fastify.register(routes, { prefix: '/geo' })
    return fastify
}
