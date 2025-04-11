// Face recognition utilities for server-side face authentication
import faceapi from 'face-api.js';
import canvas from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';

// Get current directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure face-api.js to use canvas
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Path to face-api.js models
const MODELS_PATH = path.join(__dirname, '..', 'public', 'models');

// Initialize face-api.js models
let modelsLoaded = false;
let modelLoadingPromise = null;

// Optimal image size for face detection (smaller = faster)
const OPTIMAL_IMAGE_WIDTH = 100; // Further reduced for faster processing
const OPTIMAL_IMAGE_HEIGHT = 75; // Further reduced for faster processing

// Number of CPU cores for parallel processing
const CPU_CORES = Math.max(1, os.cpus().length - 1); // Leave one core free for system

// Descriptor cache to avoid recomputing descriptors for the same face
const descriptorCache = new Map();

// Model cache to avoid reloading models
const modelCache = new Map();

// Face detection options with extremely optimized parameters for speed
const FACE_DETECTION_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 128,  // Even smaller input size for faster processing
  scoreThreshold: 0.3  // Lower threshold for faster detection
});

/**
 * Load face-api.js models with aggressive caching
 */
async function loadModels() {
  // Return existing promise if models are being loaded
  if (modelLoadingPromise) return modelLoadingPromise;
  
  // Return immediately if models are already loaded
  if (modelsLoaded) return Promise.resolve();
  
  // Create a new loading promise with parallel loading and caching
  modelLoadingPromise = (async () => {
    try {
      console.time('modelLoading');
      
      // Check if we have cached models in memory
      if (modelCache.size > 0) {
        console.log('Using cached models from memory');
        modelsLoaded = true;
        console.timeEnd('modelLoading');
        return;
      }
      
      // Initialize tiny detector first for faster loading
      await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH);
      modelCache.set('detector', faceapi.nets.tinyFaceDetector);
      
      // Then load the rest in parallel
      await Promise.all([
        faceapi.nets.faceLandmark68TinyNet.loadFromDisk(MODELS_PATH),
        faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH)
      ]);
      
      // Cache models in memory
      modelCache.set('landmarks', faceapi.nets.faceLandmark68TinyNet);
      modelCache.set('recognition', faceapi.nets.faceRecognitionNet);
      
      modelsLoaded = true;
      console.timeEnd('modelLoading');
      console.log('Face-api.js models loaded successfully');
    } catch (error) {
      console.error('Error loading face-api.js models:', error);
      throw error;
    } finally {
      // Clear the promise reference
      modelLoadingPromise = null;
    }
  })();
  
  return modelLoadingPromise;
}

// Preload models immediately on module load to reduce first request latency
try {
  setTimeout(() => loadModels(), 0);
} catch (e) {
  console.error('Failed to preload models:', e);
}

/**
 * Extreme image preprocessing for fastest possible face detection
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<canvas.Canvas>} - Preprocessed canvas
 */
async function preprocessImage(imageBuffer) {
  console.time('imagePreprocessing');
  
  try {
    // Load image - use Node canvas native methods for faster loading
    const img = await canvas.loadImage(imageBuffer);
    
    // Create a tiny canvas for ultrafast processing
    const resizedCanvas = canvas.createCanvas(OPTIMAL_IMAGE_WIDTH, OPTIMAL_IMAGE_HEIGHT);
    const resizedContext = resizedCanvas.getContext('2d', { alpha: false }); // Disable alpha for speed
    
    // Calculate aspect ratio to maintain proportions
    const scale = Math.min(
      OPTIMAL_IMAGE_WIDTH / img.width,
      OPTIMAL_IMAGE_HEIGHT / img.height
    );
    
    // Center the image in the canvas
    const scaledWidth = img.width * scale;
    const scaledHeight = img.height * scale;
    const offsetX = (OPTIMAL_IMAGE_WIDTH - scaledWidth) / 2;
    const offsetY = (OPTIMAL_IMAGE_HEIGHT - scaledHeight) / 2;
    
    // Skip all fancy processing and just do the minimum required - much faster
    resizedContext.drawImage(
      img, 
      0, 0, img.width, img.height,
      offsetX, offsetY, scaledWidth, scaledHeight
    );
    
    return resizedCanvas;
  } catch (err) {
    console.error('Image preprocessing error:', err);
    throw err;
  } finally {
    console.timeEnd('imagePreprocessing');
  }
}

/**
 * Extract face descriptor from an image with extreme optimization
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<Float32Array|null>} - Face descriptor or null if no face detected
 */
async function extractFaceDescriptor(imageBuffer) {
  // Generate a cache key based on image buffer hash
  const cacheKey = Buffer.from(imageBuffer).toString('base64').slice(0, 32);
  
  // Check if we already have this descriptor cached
  if (descriptorCache.has(cacheKey)) {
    console.log('Using cached face descriptor');
    return descriptorCache.get(cacheKey);
  }
  
  // Ensure models are loaded
  await loadModels();
  
  try {
    // Preprocess image for faster detection - ultra small size
    const resizedCanvas = await preprocessImage(imageBuffer);
    
    // Initial detection using tiny model and lower resolution
    console.time('initialDetection');
    
    // Use the bare minimum settings for detection
    const detection = await faceapi.detectSingleFace(resizedCanvas, FACE_DETECTION_OPTIONS);
    console.timeEnd('initialDetection');
    
    if (!detection) {
      console.log('No face detected in the image');
      return null;
    }
    
    console.time('descriptorExtraction');
    
    // Create a slightly higher resolution image for descriptor calculation
    // but still much smaller than original
    const img = await canvas.loadImage(imageBuffer);
    const faceCanvas = canvas.createCanvas(160, 160); // Small fixed size for descriptor
    const faceContext = faceCanvas.getContext('2d', { alpha: false });
    
    // Calculate scale from tiny detection canvas to original image
    const scaleX = img.width / resizedCanvas.width;
    const scaleY = img.height / resizedCanvas.height;
    
    // Scale up the detected face box to original image dimensions
    const scaledBox = {
      x: detection.box.x * scaleX,
      y: detection.box.y * scaleY,
      width: detection.box.width * scaleX,
      height: detection.box.height * scaleY
    };
    
    // Add margin to the face box for better descriptor quality
    const margin = Math.max(scaledBox.width, scaledBox.height) * 0.2;
    const x = Math.max(0, scaledBox.x - margin);
    const y = Math.max(0, scaledBox.y - margin);
    const width = Math.min(img.width - x, scaledBox.width + margin * 2);
    const height = Math.min(img.height - y, scaledBox.height + margin * 2);
    
    // Extract face region and scale to fixed size
    faceContext.drawImage(
      img,
      x, y, width, height,
      0, 0, faceCanvas.width, faceCanvas.height
    );
    
    // Fast track descriptor extraction using extractor directly
    const descriptor = await faceapi.computeFaceDescriptor(faceCanvas);
    console.timeEnd('descriptorExtraction');
    
    if (!descriptor) {
      console.log('Could not extract face descriptor');
      return null;
    }
    
    // Cache the descriptor for future use - limit to 50 entries
    if (descriptorCache.size > 50) {
      // Remove oldest entry
      const firstKey = descriptorCache.keys().next().value;
      descriptorCache.delete(firstKey);
    }
    descriptorCache.set(cacheKey, descriptor);
    
    return descriptor;
  } catch (error) {
    console.error('Error extracting face descriptor:', error);
    return null;
  }
}

/**
 * Optimized face descriptor comparison using SIMD-like operations
 */
function compareFaceDescriptors(descriptor1, descriptor2, threshold = 0.6) {
  if (!descriptor1 || !descriptor2) return false;
  
  // Convert descriptors to arrays if they aren't already
  const d1 = Array.isArray(descriptor1) ? descriptor1 : Array.from(descriptor1);
  const d2 = Array.isArray(descriptor2) ? descriptor2 : Array.from(descriptor2);
  
  // Fast manual calculation with loop unrolling for speed
  let sum = 0;
  const len = d1.length;
  
  // Process 8 elements at a time
  for (let i = 0; i < len; i += 8) {
    sum += 
      (i < len ? Math.pow(d1[i] - d2[i], 2) : 0) +
      (i+1 < len ? Math.pow(d1[i+1] - d2[i+1], 2) : 0) +
      (i+2 < len ? Math.pow(d1[i+2] - d2[i+2], 2) : 0) +
      (i+3 < len ? Math.pow(d1[i+3] - d2[i+3], 2) : 0) +
      (i+4 < len ? Math.pow(d1[i+4] - d2[i+4], 2) : 0) +
      (i+5 < len ? Math.pow(d1[i+5] - d2[i+5], 2) : 0) +
      (i+6 < len ? Math.pow(d1[i+6] - d2[i+6], 2) : 0) +
      (i+7 < len ? Math.pow(d1[i+7] - d2[i+7], 2) : 0);
  }
  
  const distance = Math.sqrt(sum);
  return distance < threshold;
}

/**
 * Find matching face with optimized batch processing
 */
function findMatchingFace(targetDescriptor, faceProfiles, threshold = 0.6) {
  if (!targetDescriptor || !faceProfiles || faceProfiles.length === 0) {
    return null;
  }
  
  let bestMatch = null;
  let bestDistance = Infinity;
  
  // Convert target descriptor to array for consistent comparison
  const targetArray = Array.isArray(targetDescriptor) ? targetDescriptor : Array.from(targetDescriptor);
  
  // Process each face profile
  for (const profile of faceProfiles) {
    if (!profile.faceDescriptor) continue;
    
    // Calculate distance efficiently
    const profileArray = Array.isArray(profile.faceDescriptor) 
      ? profile.faceDescriptor 
      : Array.from(profile.faceDescriptor);
    
    // Optimized distance calculation
    let sum = 0;
    const len = targetArray.length;
    
    for (let i = 0; i < len; i += 8) {
      sum += 
        (i < len ? Math.pow(targetArray[i] - profileArray[i], 2) : 0) +
        (i+1 < len ? Math.pow(targetArray[i+1] - profileArray[i+1], 2) : 0) +
        (i+2 < len ? Math.pow(targetArray[i+2] - profileArray[i+2], 2) : 0) +
        (i+3 < len ? Math.pow(targetArray[i+3] - profileArray[i+3], 2) : 0) +
        (i+4 < len ? Math.pow(targetArray[i+4] - profileArray[i+4], 2) : 0) +
        (i+5 < len ? Math.pow(targetArray[i+5] - profileArray[i+5], 2) : 0) +
        (i+6 < len ? Math.pow(targetArray[i+6] - profileArray[i+6], 2) : 0) +
        (i+7 < len ? Math.pow(targetArray[i+7] - profileArray[i+7], 2) : 0);
    }
    
    const distance = Math.sqrt(sum);
    
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = profile;
    }
  }
  
  // Only return a match if it's below the threshold
  return bestDistance < threshold 
    ? { match: bestMatch, distance: bestDistance } 
    : null;
}

/**
 * Clear the descriptor cache to free memory
 */
function clearDescriptorCache() {
  descriptorCache.clear();
  console.log('Face descriptor cache cleared');
}

export {
  loadModels,
  extractFaceDescriptor,
  compareFaceDescriptors,
  findMatchingFace,
  clearDescriptorCache
};