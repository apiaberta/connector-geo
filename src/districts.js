// Official CAOP districts + autonomous-region islands as exposed by geoapi.pt.
// Used so ingest never downloads GET /distritos (a ~17 MiB GeoJSON dump).
// No Mongo index is required for this catalog.

export const DISTRICT_CATALOG = [
    { name: 'Aveiro',              codigoine: '01' },
    { name: 'Beja',                codigoine: '02' },
    { name: 'Braga',               codigoine: '03' },
    { name: 'Bragança',            codigoine: '04' },
    { name: 'Castelo Branco',      codigoine: '05' },
    { name: 'Coimbra',             codigoine: '06' },
    { name: 'Évora',               codigoine: '07' },
    { name: 'Faro',                codigoine: '08' },
    { name: 'Guarda',              codigoine: '09' },
    { name: 'Leiria',              codigoine: '10' },
    { name: 'Lisboa',              codigoine: '11' },
    { name: 'Portalegre',          codigoine: '12' },
    { name: 'Porto',               codigoine: '13' },
    { name: 'Santarém',            codigoine: '14' },
    { name: 'Setúbal',             codigoine: '15' },
    { name: 'Viana do Castelo',    codigoine: '16' },
    { name: 'Vila Real',           codigoine: '17' },
    { name: 'Viseu',               codigoine: '18' },
    { name: 'Ilha da Madeira',     codigoine: '31' },
    { name: 'Ilha de Porto Santo', codigoine: '32' },
    { name: 'Ilha de Santa Maria', codigoine: '41' },
    { name: 'Ilha de São Miguel',  codigoine: '42' },
    { name: 'Ilha Terceira',       codigoine: '43' },
    { name: 'Ilha da Graciosa',    codigoine: '44' },
    { name: 'Ilha de São Jorge',   codigoine: '45' },
    { name: 'Ilha do Pico',        codigoine: '46' },
    { name: 'Ilha do Faial',       codigoine: '47' },
    { name: 'Ilha Das Flores',     codigoine: '48' },
    { name: 'Ilha do Corvo',       codigoine: '49' }
]
