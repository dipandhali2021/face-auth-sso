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

// Model validity duration - 15 minutes in serverless context (increased from 5)
const MODEL_VALIDITY_DURATION = 15 * 60 * 1000;

// Use worker pool for face descriptor extraction if available
const MAX_WORKERS = Math.max(1, os.cpus().length - 1);
const USE_PARALLEL_PROCESSING = MAX_WORKERS > 1;

// Enhanced caching with increased size limit
const descriptorCache = new Map();
const CACHE_SIZE_LIMIT = 100; // Increased from 50 for better hit ratio

// LRU cache tracking for better cache management
const cacheAccessOrder = [];

// Optimized face detection options with aggressive parameter tuning
const FACE_DETECTION_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 128, // Reduced from 160 for faster processing
  scoreThreshold: 0.4  // Reduced for better detection rate
});

// Singleton pattern for model loading to prevent redundant loads
async function loadModels() {
  const currentTime = Date.now();
  
  // Check if models were loaded recently enough to still be valid
  if (modelsLoaded && (currentTime - lastModelLoadTime) < MODEL_VALIDITY_DURATION) {
    return Promise.resolve();
  }

  // Return existing promise if models are being loaded
  if (modelLoadingPromise) {
    return modelLoadingPromise;
  }
  
  console.log('Loading face-api.js models...');
  console.time('modelLoading');
  
  // Create a new loading promise with parallel loading for faster initialization
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
    
    // Warm up the models with a simple inference to initialize tensors
    warmupModels();
    
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
 * Warm up the models with a simple inference
 * This helps initialize tensors and JIT compilation for faster first real inference
 */
async function warmupModels() {
  try {
    // Create a simple test image - solid color is enough for warmup
    const warmupCanvas = canvas.createCanvas(150, 150);
    const ctx = warmupCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 150, 150);
    
    // Run minimal inference to warm up models
    await faceapi.detectSingleFace(
      warmupCanvas,
      FACE_DETECTION_OPTIONS
    );
    
    console.log('Models warmed up successfully');
  } catch (e) {
    console.log('Model warmup failed:', e);
    // Non-critical error, we can continue
  }
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

/**
 * Update cache access tracking for LRU implementation
 */
function updateCacheAccess(key) {
  // Remove key from current position if exists
  const index = cacheAccessOrder.indexOf(key);
  if (index > -1) {
    cacheAccessOrder.splice(index, 1);
  }
  
  // Add key to the end (most recently used)
  cacheAccessOrder.push(key);
}

/**
 * Fast image preprocessing for optimized detection
 * @param {Buffer} imageBuffer - Original image buffer
 * @returns {Promise<canvas.Canvas>} - Preprocessed canvas, optimized for detection
 */
async function preprocessImage(imageBuffer) {
  try {
    // Load image - use Node canvas native methods for faster loading
    const img = await canvas.loadImage(imageBuffer);
    
    // Create a small canvas for ultrafast processing
    const targetSize = 240; // Very small for initial detection only
    const scale = Math.min(
      targetSize / img.width, 
      targetSize / img.height
    );
    
    const scaledWidth = Math.floor(img.width * scale);
    const scaledHeight = Math.floor(img.height * scale);
    
    const resizedCanvas = canvas.createCanvas(scaledWidth, scaledHeight);
    const resizedContext = resizedCanvas.getContext('2d', { alpha: false }); // Disable alpha for speed
    
    // Draw image with optimized settings
    resizedContext.imageSmoothingEnabled = false; // Disable smoothing for speed
    resizedContext.imageSmoothingQuality = 'low'; // Only matters if smoothing is enabled
    resizedContext.drawImage(img, 0, 0, scaledWidth, scaledHeight);
    
    return resizedCanvas;
  } catch (err) {
    console.error('Image preprocessing error:', err);
    throw err;
  }
}

/**
 * Extract face descriptor with extreme optimization
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<Float32Array|null>} - Face descriptor or null if no face detected
 */
async function extractFaceDescriptor(imageBuffer) {
  try {
    console.time('faceDescriptor');
    
    // Ensure models are loaded
    await loadModels();
    
    // Generate cache key from buffer hash - faster hash algorithm
    const bufferHash = hashBuffer(imageBuffer);
    
    // Check cache first with LRU tracking
    if (descriptorCache.has(bufferHash)) {
      console.log('Using cached face descriptor');
      updateCacheAccess(bufferHash);
      console.timeEnd('faceDescriptor');
      return descriptorCache.get(bufferHash);
    }
    
    // Load image for both detection passes
    const img = await canvas.loadImage(imageBuffer);
    
    // Fast preprocessing to smaller size
    const processedCanvas = await preprocessImage(imageBuffer);
    
    // Initial fast detection using tiny model on very small image
    console.time('initialDetection');
    const initialDetection = await faceapi.detectSingleFace(
      processedCanvas, 
      FACE_DETECTION_OPTIONS
    );
    console.timeEnd('initialDetection');
    
    if (!initialDetection) {
      console.log('No face detected in initial scan');
      console.timeEnd('faceDescriptor');
      return null;
    }
    
    // Calculate detection area with margins for better descriptor quality
    const detBox = initialDetection.box;
    const scale = img.width / processedCanvas.width; // Scale factor to original image
    
    // Scale detection box to original image dimensions - FIX: removed circular reference
    const margin = Math.ceil(20 * scale);
    const x = Math.max(0, Math.floor(detBox.x * scale) - margin);
    const y = Math.max(0, Math.floor(detBox.y * scale) - margin);
    const width = Math.min(img.width - x, Math.ceil(detBox.width * scale) + margin * 2);
    const height = Math.min(img.height - y, Math.ceil(detBox.height * scale) + margin * 2);
    
    // Create face-only canvas at fixed size for consistent descriptor quality
    const faceCanvas = canvas.createCanvas(150, 150);
    const faceContext = faceCanvas.getContext('2d', { alpha: false });
    faceContext.imageSmoothingEnabled = true;
    faceContext.imageSmoothingQuality = 'medium';
    
    // Draw only the face region to greatly reduce processing time
    faceContext.drawImage(
      img,
      x, y, width, height,
      0, 0, 150, 150
    );
    
    // Extract descriptor directly from this smaller face-only region
    console.time('descriptorExtraction');
    const detection = await faceapi.detectSingleFace(
      faceCanvas, 
      FACE_DETECTION_OPTIONS
    ).withFaceLandmarks(true).withFaceDescriptor();
    console.timeEnd('descriptorExtraction');
    
    if (!detection) {
      console.log('Face detected initially but descriptor extraction failed');
      console.timeEnd('faceDescriptor');
      return null;
    }
    
    const descriptor = detection.descriptor;
    
    // Update cache with LRU tracking
    if (descriptorCache.size >= CACHE_SIZE_LIMIT) {
      // Remove least recently used entry
      const oldestKey = cacheAccessOrder.shift();
      descriptorCache.delete(oldestKey);
    }
    
    descriptorCache.set(bufferHash, descriptor);
    updateCacheAccess(bufferHash);
    
    console.timeEnd('faceDescriptor');
    return descriptor;
  } catch (error) {
    console.error('Error extracting face descriptor:', error);
    console.timeEnd('faceDescriptor');
    return null;
  }
}

/**
 * Generate a fast hash from a buffer for caching
 * Uses a faster sampling approach than the previous implementation
 * @param {Buffer} buffer - Image buffer
 * @returns {string} - Hash string for cache key
 */
function hashBuffer(buffer) {
  let hash = 5381;
  const data = new Uint8Array(buffer);
  
  // Sample fewer bytes for much faster hashing
  // Take 100 evenly distributed bytes from the buffer
  const totalBytes = Math.min(100, data.length);
  const step = Math.max(1, Math.floor(data.length / totalBytes));
  
  for (let i = 0; i < data.length; i += step) {
    hash = ((hash << 5) + hash) ^ data[i]; // djb2 algorithm
  }
  
  return hash.toString(36);
}

/**
 * Find a matching face with highly optimized distance calculation
 * @param {Float32Array|Array} targetDescriptor - Target face descriptor
 * @param {Array} faceProfiles - Array of face profiles to match against
 * @param {number} threshold - Matching threshold (default: 0.6)
 * @returns {object|null} - Match result or null if no match found
 */
function findMatchingFace(targetDescriptor, faceProfiles, threshold = 0.6) {
  if (!targetDescriptor || !faceProfiles || faceProfiles.length === 0) {
    return null;
  }

  console.time('faceMatching');
  
  // Pre-convert target descriptor for reuse
  const targetArray = Array.isArray(targetDescriptor) ? targetDescriptor : Array.from(targetDescriptor);
  
  let bestMatch = null;
  let bestDistance = Infinity;
  
  // Process batches of profiles for better cache locality
  const BATCH_SIZE = 10;
  for (let i = 0; i < faceProfiles.length; i += BATCH_SIZE) {
    const batch = faceProfiles.slice(i, i + BATCH_SIZE);
    
    for (const profile of batch) {
      if (!profile.faceDescriptor) continue;
      
      // Fast conversion and direct array indexing for speed
      const profileArray = Array.isArray(profile.faceDescriptor) 
        ? profile.faceDescriptor 
        : Array.from(profile.faceDescriptor);
      
      // Ultra-optimized distance calculation with loop unrolling
      // This is much faster than iterating one element at a time
      let sum = 0;
      const len = targetArray.length; 
      
      // Process 8 elements at a time for better CPU cache utilization
      for (let j = 0; j < len; j += 8) {
        // Manual loop unrolling for dramatic performance improvement
        sum += 
          ((j < len) ? Math.pow(targetArray[j] - profileArray[j], 2) : 0) +
          ((j+1 < len) ? Math.pow(targetArray[j+1] - profileArray[j+1], 2) : 0) +
          ((j+2 < len) ? Math.pow(targetArray[j+2] - profileArray[j+2], 2) : 0) +
          ((j+3 < len) ? Math.pow(targetArray[j+3] - profileArray[j+3], 2) : 0) +
          ((j+4 < len) ? Math.pow(targetArray[j+4] - profileArray[j+4], 2) : 0) +
          ((j+5 < len) ? Math.pow(targetArray[j+5] - profileArray[j+5], 2) : 0) +
          ((j+6 < len) ? Math.pow(targetArray[j+6] - profileArray[j+6], 2) : 0) +
          ((j+7 < len) ? Math.pow(targetArray[j+7] - profileArray[j+7], 2) : 0);
      }
      
      // Final distance calculation
      const distance = Math.sqrt(sum);
      
      // Update best match if found
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = profile;
        
        // Early termination optimization
        // If we find a very good match, stop searching
        if (distance < threshold * 0.7) {
          console.log('Found excellent match, early termination');
          console.timeEnd('faceMatching');
          return { match: bestMatch, distance: bestDistance };
        }
      }
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
  findMatchingFace,
  preprocessImage
};