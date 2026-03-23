# API Aberta — Geographic Data Connector

Microservice for Portuguese geographic data (municipalities, districts, parishes, postal codes).

## Features

- Administrative divisions (CAOP)
- Postal codes (CTT)
- Geocoding and reverse geocoding
- District/municipality/parish hierarchy

## Endpoints

- `GET /health` — Service health check
- `GET /meta` — Service metadata
- `GET /districts` — Districts list
- `GET /municipalities` — Municipalities
- `GET /parishes` — Parishes
- `GET /postalcodes` — Postal code lookup
- `GET /geocode` — Address to coordinates
- `GET /reverse` — Coordinates to address

## Setup

```bash
npm install
cp .env.example .env
npm start
```

## Data Sources

- CAOP (Carta Administrativa Oficial de Portugal)
- CTT postal codes
- geoapi.pt

## License

MIT
