import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { User, FaceProfile, AuthCode } from '../utils/db.js';
import * as faceRecognition from '../utils/faceRecognition.js';
import * as cloudinary from '../utils/cloudinary.js';
import { generateRandomString } from '../utils/auth.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Face Authentication Page
router.get('/', (req, res) => {
  const requestData = req.query.request;
  if (!requestData) {
    return res.status(400).send('Invalid request');
  }

  try {
    // Parse the request data to validate it
    JSON.parse(Buffer.from(requestData, 'base64').toString());

    // Serve the face authentication HTML file
    res.sendFile(path.join(process.cwd(), 'public', 'face-auth.html'));
  } catch (error) {
    console.error('Error parsing request data:', error);
    res.status(400).send('Invalid request format');
  }
});

// Face Authentication Verification Endpoint
router.post('/verify', bodyParser.urlencoded({ extended: true }), async (req, res) => {
  console.time('faceAuthVerify');
  const { request, faceImage, action } = req.body;
  
  // Create performance trackers
  const perfMetrics = {
    start: Date.now(),
    imageProcessed: 0,
    faceExtracted: 0,
    matchCompleted: 0
  };

  if (!request || !faceImage) {
    return res.status(400).send('Missing required parameters');
  }

  // Define a cleanup function for session data
  const cleanupTempFile = () => {
    // Clear session data instead of deleting files
    if (req.session.tempFileName) {
      delete req.session.tempFileName;
      console.log('Temporary file reference cleared from session');
    }
  };

  try {
    const authRequest = JSON.parse(Buffer.from(request, 'base64').toString());
    const { clientId, redirectUri, state } = authRequest;

    // Properly handle base64 image data with potential padding issues
    let imageBuffer;
    try {
      // Handle both formats: with or without data:image/jpeg;base64, prefix
      const base64Data = faceImage.includes('base64,') ? 
        faceImage.split('base64,')[1] : 
        faceImage;
        
      imageBuffer = Buffer.from(base64Data, 'base64');
      
      // Validate that we have actual image data (minimum size check)
      if (imageBuffer.length < 100) {
        console.error('Invalid image data: too small');
        throw new Error('Invalid image data received');
      }
    } catch (imageError) {
      console.error('Error processing image data:', imageError);
      return res
        .status(400)
        .sendFile(path.join(process.cwd(), 'public', 'face-auth-error.html'));
    }
    
    const fileName = `${Date.now()}.jpg`;
    
    // Store a reference in the session
    req.session.tempFileName = fileName;

    // Performance monitoring for face descriptor extraction
    console.time('extractFaceDescriptor');
    console.log('Starting face descriptor extraction');
    
    try {
      // Extract face descriptor from the image - this is the most intensive operation
      const faceDescriptor = await faceRecognition.extractFaceDescriptor(
        imageBuffer
      );
      
      console.timeEnd('extractFaceDescriptor');
      perfMetrics.faceExtracted = Date.now();

      if (!faceDescriptor) {
        // No need to delete files in serverless environment
        // Just clear the session data
        cleanupTempFile();
        console.error('No face detected in the image');
        // Serve the error page for face verification failure
        return res
          .status(400)
          .sendFile(path.join(process.cwd(), 'public', 'face-auth-error.html'));
      }

      let userId;
      let isNewUser = false;
      let user = null;

      if (action === 'register') {
        // For registration, generate a new user ID and create a new face profile
        userId = generateRandomString(16);
        isNewUser = true;

        // Upload image to Cloudinary
        let cloudinaryResult;
        try {
          cloudinaryResult = await cloudinary.uploadImageToCloudinary(
            imageBuffer,
            userId
          );
          console.log(
            'Image uploaded to Cloudinary:',
            cloudinaryResult.secure_url
          );

          if (cloudinaryResult) {
            console.log(
              'Image successfully uploaded to Cloudinary:',
              cloudinaryResult.secure_url
            );
          }
        } catch (cloudinaryError) {
          console.error('Cloudinary upload failed:', cloudinaryError);
          // Continue with local file if Cloudinary fails
        }

        // Create a new face profile with the descriptor - store as array for better MongoDB performance
        const faceProfile = new FaceProfile({
          userId: userId,
          // Use Cloudinary URL instead of local file path
          faceImagePath: cloudinaryResult ? cloudinaryResult.secure_url : null,
          faceDescriptor: Array.from(faceDescriptor), // Convert Float32Array to regular array for MongoDB
          registeredAt: new Date(),
        });

        // Save the face profile to MongoDB
        await faceProfile.save();

        // Get user data from session if available (from registration form)
        // Or from the form submission if session data is not available
        let userData = req.session.userData || {
          firstName: req.body.firstName || null,
          lastName: req.body.lastName || null,
          email: req.body.email || null,
          emailVerified: true
        };

        // Create a new user with information from the registration form or generate defaults
        user = new User({
          id: userId,
          name:
            userData.firstName && userData.lastName
              ? `${userData.firstName} ${userData.lastName}`
              : `User ${userId.substring(0, 6)}`,
          firstName: userData.firstName || 'User',
          lastName: userData.lastName || userId.substring(0, 6),
          email: userData.email || `user-${userId.substring(0, 6)}@example.com`,
          emailVerified:
            userData.emailVerified !== undefined
              ? userData.emailVerified
              : true,
          faceVerified: true,
          profilePicture: cloudinaryResult
            ? cloudinaryResult.secure_url
            : null,
          registeredAt: new Date(),
          updatedAt: new Date(),
          faceProfileId: userId,
        });

        // Clear the session user data after using it
        delete req.session.userData;

        // Save the user to MongoDB
        await user.save();

        console.log('New user registered with face authentication:', userId);
      } else {
        // For authentication, find a matching face in the database
        console.log('Starting face matching process');
        // Optimize by only fetching needed fields and limiting processing
        const faceProfiles = await FaceProfile.find({}, { userId: 1, faceDescriptor: 1 });
        console.log(`Found ${faceProfiles.length} face profiles to check against`);

        perfMetrics.profilesFetched = Date.now();

        if (faceProfiles.length === 0) {
          // Delete the temporary file if no registered faces exist
          cleanupTempFile();
          console.log('No registered face profiles found');
          // Redirect to the no-registered-faces page with the request data
          return res.redirect(
            `/no-registered-faces.html?request=${encodeURIComponent(request)}`
          );
        }

        // Find the best matching face - optimize with faster algorithm
        console.time('findMatchingFace');
        const matchResult = faceRecognition.findMatchingFace(
          faceDescriptor,
          faceProfiles,
          0.6 // Set a consistent threshold here
        );
        console.timeEnd('findMatchingFace');

        if (!matchResult) {
          // Delete the temporary file if no matching face is found
          cleanupTempFile();
          console.log('No matching face found');
          // Redirect to the face-match-failed page with the request data instead of error redirect
          return res.redirect(
            `/face-match-failed.html?request=${encodeURIComponent(request)}`
          );
        }
        
        // Extract the matching profile and log the match distance for debugging
        const matchingProfile = matchResult.match;
        console.log('Face match found with distance:', matchResult.distance, 'for user ID:', matchingProfile.userId);
        perfMetrics.matchCompleted = Date.now();
        
        userId = matchingProfile.userId;

        // Get the user associated with this face profile - optimize by selecting only needed fields
        user = await User.findOne({ id: userId }, { id: 1, profilePicture: 1 });

        if (!user) {
          // Delete the temporary file if no user is found for the face
          cleanupTempFile();
          console.error('No user found for face profile ID:', userId);
          return res
            .status(401)
            .send('User not found for the authenticated face.');
        }

        console.log('User authenticated with face recognition:', userId);

        // Delete the temporary file after authentication
        cleanupTempFile();
      }

      // Store authentication session
      req.session.userId = userId;
      req.session.authenticated = true;

      // Generate authorization code
      const code = generateRandomString();
      const authCode = new AuthCode({
        code: code,
        clientId: clientId,
        userId: userId,
        redirectUri: redirectUri,
        scope: authRequest.scope,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        nonce: authRequest.nonce,
      });

      // Save the authorization code to MongoDB
      await authCode.save();

      // Redirect back to client with authorization code
      const redirectUrl = new URL(redirectUri);
      redirectUrl.searchParams.append('code', code);
      if (state) {
        redirectUrl.searchParams.append('state', state);
      }

      // Calculate and log performance metrics
      const totalTime = Date.now() - perfMetrics.start;
      console.log('Performance metrics (ms):', {
        faceExtraction: perfMetrics.faceExtracted - perfMetrics.start,
        faceMatching: perfMetrics.matchCompleted - perfMetrics.faceExtracted,
        totalProcessingTime: totalTime
      });

      // End performance timing before redirecting
      console.timeEnd('faceAuthVerify');
      res.redirect(redirectUrl.toString());
    } catch (faceProcessingError) {
      console.error('Face processing error:', faceProcessingError);
      cleanupTempFile();
      return res
        .status(400)
        .sendFile(path.join(process.cwd(), 'public', 'face-auth-error.html'));
    }
  } catch (error) {
    console.error('Error processing face authentication:', error);
    // Clean up temporary file in case of error
    cleanupTempFile();
    // End performance timing even in case of error
    console.timeEnd('faceAuthVerify');
    res.status(500).send('Authentication failed: ' + error.message);
  } finally {
    // Ensure cleanup happens even if there's an unhandled exception
    cleanupTempFile();
  }
});

export default router;