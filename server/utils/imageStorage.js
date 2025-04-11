// Image storage utility for handling uploads based on environment
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { uploadImageToCloudinary } from './cloudinary.js';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create upload directory path
const UPLOAD_DIR = path.join(__dirname, '../uploads');

// Ensure upload directory exists in dev environment
if (process.env.NODE_ENV !== 'production') {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log('Created uploads directory for development environment');
  }
}

// Configure multer storage for development environment
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.id || 'unknown';
    const uniqueId = uuidv4().substring(0, 8);
    const ext = path.extname(file.originalname);
    cb(null, `user-${userId}-${uniqueId}${ext}`);
  }
});

// Configure multer upload
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

/**
 * Handle file upload based on environment
 * @param {Buffer|string} image - Image buffer or file path
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Upload result with url
 */
async function handleImageUpload(image, userId) {
  // For production: use Cloudinary directly
  if (process.env.NODE_ENV === 'production') {
    const result = await uploadImageToCloudinary(
      Buffer.isBuffer(image) ? image : fs.readFileSync(image),
      userId
    );
    return {
      url: result.secure_url,
      publicId: result.public_id,
      provider: 'cloudinary'
    };
  } 
  // For development: store locally and return the file path
  else {
    // If image is already a path (from multer), just use it
    if (typeof image === 'string') {
      return {
        url: `/uploads/${path.basename(image)}`,
        filePath: image,
        provider: 'local'
      };
    }
    
    // If image is a buffer, save it to a file
    const filename = `user-${userId}-${uuidv4().substring(0, 8)}.jpg`;
    const filePath = path.join(UPLOAD_DIR, filename);
    
    fs.writeFileSync(filePath, image);
    
    return {
      url: `/uploads/${filename}`,
      filePath: filePath,
      provider: 'local'
    };
  }
}

/**
 * Clean up locally stored image files
 * @param {string} filePath - Path to the file to delete
 */
function cleanupLocalImage(filePath) {
  if (process.env.NODE_ENV !== 'production' && filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`Cleaned up temporary file: ${filePath}`);
    } catch (error) {
      console.error(`Error cleaning up file ${filePath}:`, error);
    }
  }
}

export { 
  upload, 
  handleImageUpload, 
  cleanupLocalImage, 
  UPLOAD_DIR 
};