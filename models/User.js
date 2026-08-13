const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    default: 'User'
  },
  username: {
    type: String,
    default: ''
  },
  role: {
    type: String,
    enum: ['ADMIN', 'CONTRIBUTOR', 'USER'],
    default: 'USER'
  },
  isAddAuthorized: {
    type: Boolean,
    default: false
  },
  allowedBatches: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch'
  }]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
