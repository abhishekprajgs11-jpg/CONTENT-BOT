const mongoose = require('mongoose');

const accessRequestSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  userName: {
    type: String,
    default: 'User'
  },
  userUsername: {
    type: String,
    default: ''
  },
  requestType: {
    type: String,
    enum: ['ADD_BATCH', 'BATCH_ACCESS'],
    required: true
  },
  requestedBatches: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch'
  }],
  status: {
    type: String,
    enum: ['PENDING', 'GRANTED', 'DENIED'],
    default: 'PENDING'
  }
}, { timestamps: true });

module.exports = mongoose.model('AccessRequest', accessRequestSchema);
