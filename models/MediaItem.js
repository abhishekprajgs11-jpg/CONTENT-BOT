const mongoose = require('mongoose');

const mediaItemSchema = new mongoose.Schema({
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch',
    required: true,
    index: true
  },
  fileId: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    enum: ['video', 'document', 'photo', 'audio'],
    required: true
  },
  caption: {
    type: String,
    default: ''
  },
  sequenceOrder: {
    type: Number,
    required: true,
    index: true
  }
}, { timestamps: true });

module.exports = mongoose.model('MediaItem', mediaItemSchema);
