const mongoose = require('mongoose');

const batchSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['OPTIONAL', 'GS', 'MATHEMATICS', 'MAINS', 'PRELIMS', 'MISCELLANEOUS'],
    required: true
  },
  createdBy: {
    type: String,
    required: true
  },
  totalFiles: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('Batch', batchSchema);
