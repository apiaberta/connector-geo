import mongoose from 'mongoose'

const municipalitySchema = new mongoose.Schema({
  codigoine:   { type: String, index: true },
  name:        { type: String, required: true, index: true },
  slug:        { type: String, required: true, unique: true, index: true },
  district:    { type: String, index: true },
  area_ha:     { type: Number },
  email:       { type: String },
  phone:       { type: String },
  website:     { type: String },
  postal_code: { type: String },
  coords: {
    lat: { type: Number },
    lng: { type: Number }
  },
  geojson:   { type: mongoose.Schema.Types.Mixed },
  synced_at: { type: Date, default: Date.now }
})

export const Municipality = mongoose.model('Municipality', municipalitySchema)
