const mongoose = require('mongoose');

const stateSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  step: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: null
  },
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch',
    default: null
  },
  selectedBatches: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch'
  }],
  mediaCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('State', stateSchema);
