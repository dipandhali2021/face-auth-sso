import express from 'express';
import { User, FaceProfile, Token, AuthCode } from '../utils/db.js';
import * as cloudinary from '../utils/cloudinary.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = express.Router();

// Check admin authentication status
router.get('/status', authenticateAdmin, (req, res) => {
  res.status(200).json({ 
    status: 'authorized',
    message: 'Admin token is valid'
  });
});

// Endpoint to delete all MongoDB data and Cloudinary uploads
router.delete('/delete-all-data', authenticateAdmin, async (req, res) => {
  try {
    // Step 1: Get all face profiles to retrieve Cloudinary public IDs
    const faceProfiles = await FaceProfile.find({});
    console.log(`Found ${faceProfiles.length} face profiles to delete`);
    
    // Step 2: Extract Cloudinary public IDs from image URLs
    const cloudinaryPromises = faceProfiles.map(profile => {
      // Only process Cloudinary URLs (not local file paths)
      if (profile.faceImagePath && profile.faceImagePath.includes('cloudinary.com')) {
        try {
          // Extract public_id from Cloudinary URL
          // Format usually: https://res.cloudinary.com/[cloud_name]/image/upload/v[version]/[public_id]
          const urlParts = profile.faceImagePath.split('/');
          const fileName = urlParts[urlParts.length - 1];
          const publicId = fileName.split('.')[0]; // Remove file extension if any
          
          return cloudinary.deleteImageFromCloudinary(publicId);
        } catch (err) {
          console.error(`Failed to delete Cloudinary image for user ${profile.userId}:`, err);
          return Promise.resolve(); // Continue with other deletions
        }
      }
      return Promise.resolve(); // Skip non-Cloudinary URLs
    });
    
    // Step 3: Delete all Cloudinary images
    await Promise.all(cloudinaryPromises);
    console.log('All Cloudinary images deleted successfully');
    
    // Step 4: Delete all MongoDB collections data
    const deleteUsers = await User.deleteMany({});
    const deleteFaceProfiles = await FaceProfile.deleteMany({});
    const deleteTokens = await Token.deleteMany({});
    const deleteAuthCodes = await AuthCode.deleteMany({});
    
    console.log('MongoDB data deletion results:', {
      users: deleteUsers.deletedCount,
      faceProfiles: deleteFaceProfiles.deletedCount,
      tokens: deleteTokens.deletedCount,
      authCodes: deleteAuthCodes.deletedCount
    });
    
    res.status(200).json({
      success: true,
      message: 'All data deleted successfully',
      details: {
        usersDeleted: deleteUsers.deletedCount,
        faceProfilesDeleted: deleteFaceProfiles.deletedCount,
        tokensDeleted: deleteTokens.deletedCount,
        authCodesDeleted: deleteAuthCodes.deletedCount,
        cloudinaryImagesDeleted: faceProfiles.length
      }
    });
  } catch (error) {
    console.error('Error deleting all data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete all data',
      error: error.message
    });
  }
});

export default router;