const mongoose = require('mongoose');

const PhotoSchema = new mongoose.Schema(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
    },
    devicePhotoId: {
      type: String,
      default: '',
      index: true,
    },
    mimeType: {
      type: String,
      default: 'image/jpeg',
    },
    sizeBytes: {
      type: Number,
      default: 0,
    },
    storagePath: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    deviceDateAdded: {
      type: Date,
      default: null,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Virtual for formatted size
PhotoSchema.virtual('sizeMB').get(function () {
  return (this.sizeBytes / (1024 * 1024)).toFixed(2);
});

module.exports = mongoose.model('Photo', PhotoSchema);
