import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import * as cloudinary from '../utils/cloudinary.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up multer with memory storage for serverless environment
const storage = multer.memoryStorage();
const upload = multer({ storage });

// User Registration Form
router.get('/register', (req, res) => {
  const requestData = req.query.request;
  if (!requestData) {
    return res.status(400).send('Invalid request');
  }

  // Serve the registration form HTML file
  res.sendFile(path.join(process.cwd(), 'public', 'register.html'));
});

// Handle Registration Form Submission
router.post(
  '/register-user',
  bodyParser.urlencoded({ extended: true }),
  async (req, res) => {
    const { request, firstName, lastName, username, email, phone } = req.body;

    if (!request || !firstName || !lastName || !email) {
      return res.status(400).send('Missing required parameters');
    }

    try {
      // Store user data in session for later use during face verification
      req.session.userData = {
        firstName,
        lastName,
        email,
        emailVerified: true
      };

      // Redirect to face capture page with the request data
      res.redirect(`/face-capture.html?request=${encodeURIComponent(request)}`);
    } catch (error) {
      console.error('Error processing registration:', error);
      res.status(500).send('Registration failed: ' + error.message);
    }
  }
);

// Image upload endpoint using Cloudinary for serverless environment
router.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) {
    console.error('No file uploaded.');
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  console.log('Received file in memory:', req.file.originalname);
  
  try {
    // Generate a unique ID for the upload
    const uniqueId = Math.floor(Date.now() / 1000).toString();
    
    // Upload directly to Cloudinary from memory
    const cloudinaryResult = await cloudinary.uploadImageToCloudinary(
      req.file.buffer,
      uniqueId
    );
    
    console.log('Uploaded to Cloudinary:', cloudinaryResult.secure_url);
    
    // Return the Cloudinary URL
    res.status(200).json({ 
      fileName: req.file.originalname, 
      filePath: cloudinaryResult.secure_url 
    });
  } catch (error) {
    console.error('Upload to Cloudinary failed:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

export default router;