import mongoose from 'mongoose'

const parishSchema = new mongoose.Schema({
  name:         { type: String, required: true, index: true },
  municipality: { type: String, index: true },
  district:     { type: String, index: true },
  synced_at:    { type: Date, default: Date.now }
})

parishSchema.index({ name: 1, municipality: 1 }, { unique: true })

export const Parish = mongoose.model('Parish', parishSchema)
