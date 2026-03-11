import mongoose from 'mongoose'

const districtSchema = new mongoose.Schema({
  codigoine: { type: String, required: true, unique: true, index: true },
  name:      { type: String, required: true },
  geojson:   { type: mongoose.Schema.Types.Mixed },
  synced_at: { type: Date, default: Date.now }
})

export const District = mongoose.model('District', districtSchema)
