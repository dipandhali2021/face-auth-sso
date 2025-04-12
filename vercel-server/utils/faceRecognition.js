// Face recognition utilities for server-side face authentication
import faceapi from 'face-api.js';
import canvas from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// Get current directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure face-api.js to use canvas
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Path to face-api.js models
const MODELS_PATH = path.join(__dirname, '..', 'public', 'models');

// Global model state tracking
let modelsLoaded = false;
let modelLoadingPromise = null;
let lastModelLoadTime = 0;

// Model validity duration - 5 minutes in serverless context
const MODEL_VALIDITY_DURATION = 5 * 60 * 1000;

// Singleton pattern for model loading to prevent redundant loads
async function loadModels() {
  const currentTime = Date.now();
  
  // Check if models were loaded recently enough to still be valid
  if (modelsLoaded && (currentTime - lastModelLoadTime) < MODEL_VALIDITY_DURATION) {
    console.log('Using recently loaded models');
    return Promise.resolve();
  }

  // Return existing promise if models are being loaded
  if (modelLoadingPromise) {
    console.log('Models already loading, waiting for completion');
    return modelLoadingPromise;
  }
  
  console.log('Loading face-api.js models...');
  console.time('modelLoading');
  
  // Create a new loading promise
  modelLoadingPromise = Promise.all([
    // Use TinyFaceDetector for much faster detection with acceptable accuracy
    faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH),
    // Use tiny landmarks model which is much faster
    faceapi.nets.faceLandmark68TinyNet.loadFromDisk(MODELS_PATH),
    // Face recognition is required for face matching
    faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH)
  ])
  .then(() => {
    console.timeEnd('modelLoading');
    console.log('Face-api.js models loaded successfully');
    modelsLoaded = true;
    lastModelLoadTime = Date.now();
    modelLoadingPromise = null;
  })
  .catch(error => {
    console.error('Error loading face-api.js models:', error);
    modelLoadingPromise = null;
    throw error;
  });
  
  return modelLoadingPromise;
}

/**
 * Check if models are loaded without forcing a load
 * This is useful for health checks and monitoring
 * @returns {Promise<object>} Status of model loading
 */
async function checkModels() {
  const currentTime = Date.now();
  const timeSinceLastLoad = currentTime - lastModelLoadTime;
  
  return {
    loaded: modelsLoaded,
    loading: !!modelLoadingPromise,
    timeSinceLastLoad: modelsLoaded ? timeSinceLastLoad : null,
    isValid: modelsLoaded && (timeSinceLastLoad < MODEL_VALIDITY_DURATION),
    lastLoadTime: lastModelLoadTime ? new Date(lastModelLoadTime).toISOString() : null
  };
}

// Memory-efficient descriptor cache using WeakMap
const descriptorCache = new Map();
const CACHE_SIZE_LIMIT = 50; // Limit cache size for memory efficiency

// Optimized face detection options
const FACE_DETECTION_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 160, // Smaller for faster processing
  scoreThreshold: 0.5
});

/**
 * Extract face descriptor with optimized processing path
 */
async function extractFaceDescriptor(imageBuffer) {
  try {
    console.time('faceDescriptor');
    
    // Ensure models are loaded
    await loadModels();
    
    // Generate cache key from buffer hash
    const bufferHash = hashBuffer(imageBuffer);
    
    // Check cache first
    if (descriptorCache.has(bufferHash)) {
      console.log('Using cached face descriptor');
      console.timeEnd('faceDescriptor');
      return descriptorCache.get(bufferHash);
    }
    
    // Load image
    const img = await canvas.loadImage(imageBuffer);
    
    // Optimize image size for faster processing
    const maxDimension = 320; // Good balance between speed and accuracy
    const scale = Math.min(maxDimension / img.width, maxDimension / img.height);
    
    const scaledWidth = Math.floor(img.width * scale);
    const scaledHeight = Math.floor(img.height * scale);
    
    // Create canvas at optimized size
    const cvs = canvas.createCanvas(scaledWidth, scaledHeight);
    const ctx = cvs.getContext('2d');
    ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
    
    // Fast detection with TinyFaceDetector
    console.time('detection');
    const detection = await faceapi.detectSingleFace(
      cvs, 
      FACE_DETECTION_OPTIONS
    ).withFaceLandmarks(true).withFaceDescriptor();
    console.timeEnd('detection');
    
    if (!detection) {
      console.log('No face detected');
      console.timeEnd('faceDescriptor');
      return null;
    }
    
    // Cache the result before returning
    if (descriptorCache.size >= CACHE_SIZE_LIMIT) {
      // Remove oldest entry when limit reached
      const firstKey = descriptorCache.keys().next().value;
      descriptorCache.delete(firstKey);
    }
    descriptorCache.set(bufferHash, detection.descriptor);
    
    console.timeEnd('faceDescriptor');
    return detection.descriptor;
  } catch (error) {
    console.error('Error extracting face descriptor:', error);
    console.timeEnd('faceDescriptor');
    return null;
  }
}

/**
 * Generate a simple hash from a buffer for caching
 */
function hashBuffer(buffer) {
  let hash = 0;
  const data = new Uint8Array(buffer);
  // Only use parts of the buffer for faster hashing
  const step = Math.max(1, Math.floor(data.length / 200));
  
  for (let i = 0; i < data.length; i += step) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Find a matching face with optimized distance calculation
 */
function findMatchingFace(targetDescriptor, faceProfiles, threshold = 0.6) {
  if (!targetDescriptor || !faceProfiles || faceProfiles.length === 0) {
    return null;
  }

  console.time('faceMatching');
  let bestMatch = null;
  let bestDistance = Infinity;
  
  // Convert target to array for consistent comparison
  const targetArray = Array.isArray(targetDescriptor) ? targetDescriptor : Array.from(targetDescriptor);
  
  // Optimized loop for performance
  for (const profile of faceProfiles) {
    if (!profile.faceDescriptor) continue;
    
    // Calculate Euclidean distance efficiently
    const profileDescriptor = Array.isArray(profile.faceDescriptor) ? 
                             profile.faceDescriptor : 
                             Array.from(profile.faceDescriptor);
    
    let distance = 0;
    for (let i = 0; i < targetArray.length; i++) {
      const diff = targetArray[i] - profileDescriptor[i];
      distance += diff * diff;
    }
    distance = Math.sqrt(distance);
    
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = profile;
    }
  }
  
  console.timeEnd('faceMatching');
  console.log('Best match distance:', bestDistance);
  
  // Return match if distance is below threshold
  return bestDistance <= threshold ? { match: bestMatch, distance: bestDistance } : null;
}

export {
  loadModels,
  checkModels,
  extractFaceDescriptor,
  findMatchingFace
};