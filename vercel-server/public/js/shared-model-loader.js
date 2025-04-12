/**
 * Simplified Face-API.js Model Loader for Vercel deployment
 * This streamlined loader is optimized for reliability in serverless environments
 */

// Global model state tracking
window.FaceAPI = window.FaceAPI || {
  modelsPath: '/models',
  modelsLoaded: false,
  modelLoadingPromise: null,
  lastModelLoadTime: 0,
  modelVersion: '1.1.0', // Force reset with new version
  faceDetectionReady: false,
  faceRecognitionReady: false,
  loadRetries: 0,
  maxRetries: 3
};

// Optimized face detection options for better performance
const getFaceDetectionOptions = () => {
  return new faceapi.TinyFaceDetectorOptions({
    inputSize: 160, // Smaller for faster processing
    scoreThreshold: 0.5
  });
};

// Simple verification that models are loaded and working
async function verifyModelsLoaded() {
  try {
    // Create a simple test canvas
    const testCanvas = document.createElement('canvas');
    testCanvas.width = 100;
    testCanvas.height = 100;
    const ctx = testCanvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 100, 100);
    
    // Try to use the face detector
    await faceapi.detectSingleFace(
      testCanvas,
      getFaceDetectionOptions()
    );
    
    console.log('✓ Face detection models verified');
    return true;
  } catch (error) {
    console.error('⚠️ Models verification failed:', error.message);
    return false;
  }
}

// Direct model loading - simpler approach with no caching complexity
async function loadFaceApiModels(progressCallback = () => {}) {
  if (window.FaceAPI.modelLoadingPromise) {
    return window.FaceAPI.modelLoadingPromise;
  }
  
  console.log('🔄 Loading face-api.js models...');
  progressCallback(10);
  
  window.FaceAPI.modelLoadingPromise = (async () => {
    try {
      // Basic method of loading models that works more reliably
      const basePath = window.FaceAPI.modelsPath;
      
      // Load the face detector first for better UX
      progressCallback(20);
      await faceapi.nets.tinyFaceDetector.load(basePath);
      window.FaceAPI.faceDetectionReady = true;
      progressCallback(50);
      
      // Load other required models
      await Promise.all([
        faceapi.nets.faceLandmark68TinyNet.load(basePath),
        faceapi.nets.faceRecognitionNet.load(basePath)
      ]);
      
      progressCallback(80);
      
      // Verify the models are working
      const modelsVerified = await verifyModelsLoaded();
      
      if (!modelsVerified) {
        throw new Error('Models loaded but verification failed');
      }
      
      window.FaceAPI.faceRecognitionReady = true;
      window.FaceAPI.modelsLoaded = true;
      window.FaceAPI.lastModelLoadTime = Date.now();
      progressCallback(100);
      
      // Dispatch event for UI to update
      window.dispatchEvent(new CustomEvent('faceApiModelsLoaded'));
      
      console.log('✅ Models loaded successfully');
      window.FaceAPI.modelLoadingPromise = null;
      return true;
    } catch (error) {
      console.error('❌ Error loading models:', error.message);
      window.FaceAPI.modelLoadingPromise = null;
      
      // Retry loading if under max retries
      if (window.FaceAPI.loadRetries < window.FaceAPI.maxRetries) {
        window.FaceAPI.loadRetries++;
        console.log(`🔁 Retrying model load (${window.FaceAPI.loadRetries}/${window.FaceAPI.maxRetries})`);
        
        // Reset state
        window.FaceAPI.faceDetectionReady = false;
        window.FaceAPI.faceRecognitionReady = false;
        
        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        return loadFaceApiModels(progressCallback);
      }
      
      throw error;
    }
  })();
  
  return window.FaceAPI.modelLoadingPromise;
}

// Force reload models when needed
function forceReloadModels(progressCallback = () => {}) {
  // Reset all model state
  window.FaceAPI.modelsLoaded = false;
  window.FaceAPI.faceDetectionReady = false;
  window.FaceAPI.faceRecognitionReady = false;
  window.FaceAPI.modelLoadingPromise = null;
  window.FaceAPI.loadRetries = 0;
  
  // Force unload models if possible
  try {
    faceapi.nets.tinyFaceDetector.isLoaded = false;
    faceapi.nets.faceLandmark68TinyNet.isLoaded = false;
    faceapi.nets.faceRecognitionNet.isLoaded = false;
  } catch (e) {
    console.error('Error resetting models:', e);
  }
  
  // Reload
  return loadFaceApiModels(progressCallback);
}

// Simplified face detection with error handling
async function detectFaces(videoElement) {
  if (!window.FaceAPI.faceDetectionReady) {
    console.warn('Face detection not ready, loading models...');
    try {
      await loadFaceApiModels();
    } catch (e) {
      console.error('Failed to load models for detection:', e.message);
      return [];
    }
  }
  
  try {
    return await faceapi.detectAllFaces(
      videoElement,
      getFaceDetectionOptions()
    );
  } catch (error) {
    console.error('Face detection error:', error.message);
    
    // If detection fails but models should be loaded, something is wrong
    if (window.FaceAPI.faceDetectionReady) {
      window.FaceAPI.faceDetectionReady = false; // Reset state
      try {
        await forceReloadModels(); // Try to recover
      } catch (e) {
        console.error('Failed to reload models after error');
      }
    }
    return [];
  }
}

// Full face detection with descriptor for authentication
async function detectFaceWithDescriptor(imageElement) {
  if (!window.FaceAPI.modelsLoaded) {
    await loadFaceApiModels();
  }
  
  try {
    return await faceapi.detectSingleFace(
      imageElement,
      getFaceDetectionOptions()
    )
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  } catch (error) {
    console.error('Face descriptor extraction error:', error.message);
    return null;
  }
}

// Preload models when document is ready
document.addEventListener('DOMContentLoaded', () => {
  // Small delay to allow page to render first
  setTimeout(() => {
    loadFaceApiModels(percent => {
      console.log(`Model loading progress: ${percent}%`);
    }).catch(err => {
      console.error('Failed to preload models:', err.message);
    });
  }, 100);
});

// Debug function to help diagnose issues
function debugModelStatus() {
  const status = {
    modelsLoaded: window.FaceAPI.modelsLoaded,
    faceDetectionReady: window.FaceAPI.faceDetectionReady,
    faceRecognitionReady: window.FaceAPI.faceRecognitionReady,
    lastLoadTime: window.FaceAPI.lastModelLoadTime 
      ? new Date(window.FaceAPI.lastModelLoadTime).toISOString()
      : 'never',
    modelVersion: window.FaceAPI.modelVersion,
    loadRetries: window.FaceAPI.loadRetries,
    tinyFaceDetectorLoaded: faceapi.nets.tinyFaceDetector.isLoaded,
    faceLandmark68TinyNetLoaded: faceapi.nets.faceLandmark68TinyNet.isLoaded,
    faceRecognitionNetLoaded: faceapi.nets.faceRecognitionNet.isLoaded
  };
  
  console.table(status);
  return status;
}

// Export functions for global access
window.FaceAPILoader = {
  loadFaceApiModels,
  forceReloadModels,
  detectFaces,
  detectFaceWithDescriptor,
  getFaceDetectionOptions,
  debugModelStatus
};