require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const os = require('os');
const archiver = require('archiver');
const Photo = require('./models/Photo');

const app = express();
app.set('trust proxy', 1); // Trust Render & Cloud reverse proxies for HTTPS
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gallery_db';

// Helper to get dynamic base URL with protocol (https on Render / cloud)
function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.get('host');
  return `${proto}://${host}`;
}

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(morgan('dev'));

// Static serving for uploaded photos and web dashboard
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

// Fallback in-memory cache if MongoDB is offline
let isMongoConnected = false;
let fallbackPhotos = [];

// Connect to MongoDB
mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
})
  .then(() => {
    isMongoConnected = true;
    console.log('✅ Connected to MongoDB successfully:', MONGODB_URI);
  })
  .catch((err) => {
    isMongoConnected = false;
    console.warn('⚠️  MongoDB connection warning:', err.message);
    console.warn('👉 Server will continue running! Files will be saved to disk & local cache.');
    console.warn('👉 To connect MongoDB later, start mongod or set MONGODB_URI in server/.env');
  });

mongoose.connection.on('connected', () => {
  isMongoConnected = true;
});

mongoose.connection.on('disconnected', () => {
  isMongoConnected = false;
});

// Configure Multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    cb(null, `photo_${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per photo
  },
});

// Helper: Get local network IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ============================================================
//  API ROUTES
// ============================================================

/**
 * Health check & status endpoint
 */
app.get('/api/status', async (req, res) => {
  let photoCount = 0;
  if (isMongoConnected) {
    try {
      photoCount = await Photo.countDocuments();
    } catch {
      photoCount = fallbackPhotos.length;
    }
  } else {
    photoCount = fallbackPhotos.length;
  }

  res.json({
    status: 'ok',
    serverTime: new Date().toISOString(),
    mongoConnected: isMongoConnected,
    mongoUri: MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@'),
    totalPhotos: photoCount,
    port: PORT,
    hostIp: getLocalIpAddress(),
  });
});

/**
 * Upload single photo from Android app
 * Accepts multipart/form-data with field name 'photo' or 'file'
 */
app.post('/api/upload', (req, res) => {
  upload.any()(req, res, async (err) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({ success: false, error: err.message });
    }

    const file = (req.files && req.files.length > 0) ? req.files[0] : req.file;

    if (!file) {
      console.warn('Upload received but no file found. Headers:', req.headers['content-type']);
      return res.status(400).json({ success: false, error: 'No image file uploaded' });
    }

    const baseUrl = getBaseUrl(req);
    const photoUrl = `${baseUrl}/uploads/${file.filename}`;
    const originalName = req.body.originalName || file.originalname || file.filename;
    const devicePhotoId = req.body.id || req.body.devicePhotoId || '';
    const dateAdded = req.body.dateAdded ? new Date(Number(req.body.dateAdded) * 1000) : new Date();

    const photoData = {
      fileName: file.filename,
      originalName,
      devicePhotoId: String(devicePhotoId),
      mimeType: file.mimetype || 'image/jpeg',
      sizeBytes: file.size,
      storagePath: file.path,
      url: photoUrl,
      deviceDateAdded: dateAdded,
      uploadedAt: new Date(),
    };

    if (isMongoConnected) {
      try {
        const photoDoc = await Photo.create(photoData);
        return res.status(201).json({
          success: true,
          message: 'Photo uploaded and saved to MongoDB',
          photo: photoDoc,
        });
      } catch (dbErr) {
        console.warn('MongoDB save error, keeping in disk fallback:', dbErr.message);
      }
    }

    // Fallback mode
    const fallbackItem = { ...photoData, _id: `fallback_${Date.now()}` };
    fallbackPhotos.unshift(fallbackItem);

    return res.status(201).json({
      success: true,
      message: 'Photo uploaded to disk & local cache (MongoDB offline)',
      photo: fallbackItem,
    });
  });
});

/**
 * Upload multiple photos in one batch
 */
app.post('/api/upload-batch', upload.array('photos', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const baseUrl = getBaseUrl(req);
    const savedPhotos = [];

    for (const file of req.files) {
      const photoUrl = `${baseUrl}/uploads/${file.filename}`;
      const photoData = {
        fileName: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype || 'image/jpeg',
        sizeBytes: file.size,
        storagePath: file.path,
        url: photoUrl,
        uploadedAt: new Date(),
      };

      if (isMongoConnected) {
        try {
          const doc = await Photo.create(photoData);
          savedPhotos.push(doc);
          continue;
        } catch (e) {
          console.warn('Batch DB save error:', e.message);
        }
      }

      const fallbackItem = { ...photoData, _id: `fallback_${Date.now()}_${savedPhotos.length}` };
      fallbackPhotos.unshift(fallbackItem);
      savedPhotos.push(fallbackItem);
    }

    res.status(201).json({
      success: true,
      count: savedPhotos.length,
      photos: savedPhotos,
    });
  } catch (err) {
    console.error('Batch upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get all photos list
 */
app.get('/api/photos', async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);

    if (isMongoConnected) {
      const photos = await Photo.find().sort({ uploadedAt: -1 }).lean();
      // Ensure URL matches current host
      const updatedPhotos = photos.map(p => ({
        ...p,
        url: `${baseUrl}/uploads/${p.fileName}`
      }));
      return res.json({ success: true, count: updatedPhotos.length, photos: updatedPhotos });
    }

    // Disk fallback: also check uploads folder
    const diskFiles = fs.readdirSync(uploadsDir).filter(f => !f.startsWith('.'));
    const allPhotos = diskFiles.map(filename => {
      const stat = fs.statSync(path.join(uploadsDir, filename));
      return {
        _id: filename,
        fileName: filename,
        originalName: filename,
        sizeBytes: stat.size,
        url: `${baseUrl}/uploads/${filename}`,
        uploadedAt: stat.birthtime || stat.mtime,
      };
    }).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ success: true, count: allPhotos.length, photos: allPhotos });
  } catch (err) {
    console.error('Fetch photos error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Delete a photo by ID or filename
 */
app.delete('/api/photos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let photo = null;

    if (isMongoConnected && mongoose.isValidObjectId(id)) {
      photo = await Photo.findByIdAndDelete(id);
    }

    const filename = photo ? photo.fileName : id;
    const filePath = path.join(uploadsDir, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    fallbackPhotos = fallbackPhotos.filter(p => p._id !== id && p.fileName !== id);

    res.json({ success: true, message: 'Photo deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Delete all photos
 */
app.delete('/api/photos', async (req, res) => {
  try {
    if (isMongoConnected) {
      await Photo.deleteMany({});
    }

    const files = fs.readdirSync(uploadsDir);
    for (const file of files) {
      if (!file.startsWith('.')) {
        try {
          fs.unlinkSync(path.join(uploadsDir, file));
        } catch {}
      }
    }

    fallbackPhotos = [];
    res.json({ success: true, message: 'All photos deleted from server' });
  } catch (err) {
    console.error('Clear error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Download all uploaded photos as a single high-speed ZIP archive
 */
app.get(['/api/photos/download-all', '/api/download-all'], async (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir).filter(f => !f.startsWith('.'));

    if (files.length === 0) {
      return res.status(404).json({ success: false, error: 'No photos to download' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipFilename = `All_Photos_Backup_${timestamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = archiver('zip', {
      zlib: { level: 5 } // Fast balanced compression
    });

    archive.on('error', (err) => {
      console.error('Archiver error:', err);
      if (!res.headersSent) {
        res.status(500).send({ error: err.message });
      }
    });

    archive.pipe(res);

    for (const filename of files) {
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: filename });
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Download-all error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

/**
 * Download single photo with original filename
 */
app.get('/api/photos/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    let photo = null;
    if (isMongoConnected && mongoose.isValidObjectId(id)) {
      photo = await Photo.findById(id);
    }
    const filename = photo ? photo.fileName : id;
    const downloadName = (photo && photo.originalName) ? photo.originalName : filename;
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Photo not found');
    }

    res.download(filePath, downloadName);
  } catch (err) {
    console.error('Single download error:', err);
    res.status(500).send('Error downloading photo');
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log('\n============================================================');
  console.log('🚀 GALLERY SERVER RUNNING (Node.js + Express + MongoDB)');
  console.log('============================================================');
  console.log(`💻 Local Web Dashboard:   http://localhost:${PORT}`);
  console.log(`📱 Wi-Fi (Android Phone):  http://${localIp}:${PORT}`);
  console.log(`🤖 Android Emulator:       http://10.0.2.2:${PORT}`);
  console.log('============================================================\n');
});
