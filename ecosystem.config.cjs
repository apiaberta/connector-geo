module.exports = {
    apps: [{
        name: 'apiaberta-geo',
        script: 'src/index.js',
        cwd: '/data/apiaberta/connector-geo',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '300M',
        env: {
            NODE_ENV: 'production',
            PORT: 3009,
            MONGO_URI: 'mongodb://localhost:27017/apiaberta-geo',
            NODE_OPTIONS: '--max-old-space-size=192',
            SYNC_CRON: '45 4 * * *',
            SYNC_TZ: 'Europe/Lisbon',
            SYNC_REFRESH_DAYS: '7',
            SYNC_CONCURRENCY: '2'
        }
    }]
}
