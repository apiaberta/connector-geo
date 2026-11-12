import { describe, it } from 'node:test'
import './helpers.js'
import assert from 'node:assert/strict'
import {
    SYNC_CRON,
    SYNC_TZ,
    assertSafeMongoUri,
    isLocalMongoUri
} from '../src/config.js'

describe('config', () => {
    it('schedules full ingest at 04:45 Europe/Lisbon by default', () => {
        assert.equal(SYNC_CRON, '45 4 * * *')
        assert.equal(SYNC_TZ, 'Europe/Lisbon')
    })

    it('treats only loopback/compose hosts as local MongoDB', () => {
        assert.equal(isLocalMongoUri('mongodb://localhost:27017/apiaberta-geo'), true)
        assert.equal(isLocalMongoUri('mongodb://127.0.0.1:27017/test'), true)
        assert.equal(isLocalMongoUri('mongodb://mongo:27017/geo'), true)
        assert.equal(isLocalMongoUri('mongodb://db.internal:27017/apiaberta-geo'), false)
    })

    it('refuses a non-local URI outside production', () => {
        assert.throws(
            () => assertSafeMongoUri('mongodb://prod.example:27017/apiaberta-geo', 'test'),
            /Refusing non-local MONGO_URI/
        )
        assert.doesNotThrow(() => assertSafeMongoUri('mongodb://prod.example:27017/apiaberta-geo', 'production'))
    })
})
