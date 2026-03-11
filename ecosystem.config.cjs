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
      MONGO_URI: 'mongodb://localhost:27017/apiaberta-geo'
    }
  }]
}
