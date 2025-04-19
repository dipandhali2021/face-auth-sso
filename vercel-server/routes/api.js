import express from 'express';
import mongoose from 'mongoose';
import * as faceRecognition from '../utils/faceRecognition.js';

const router = express.Router();

// Create a warmup endpoint to help with model loading in serverless environments
router.get('/warmup', async (req, res) => {
  try {
    // Load models if they aren't already loaded
    await faceRecognition.loadModels();
    
    // Return success with model status
    res.status(200).json({ 
      status: 'ok',
      modelsLoaded: true,
      message: 'Models successfully loaded and ready'
    });
  } catch (error) {
    console.error('Warmup error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to load models during warmup' 
    });
  }
});

// Health check endpoint that includes model status
router.get('/health', async (req, res) => {
  try {
    // Check models without forcing a load
    const modelsStatus = await faceRecognition.checkModels();
    
    // Check database connection
    const dbConnected = mongoose.connection.readyState === 1;
    
    res.status(200).json({
      status: 'ok',
      server: 'running',
      database: dbConnected ? 'connected' : 'disconnected',
      faceModels: modelsStatus,
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Health check failed'
    });
  }
});

export default router;