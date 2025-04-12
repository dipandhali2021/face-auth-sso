/**
 * Shared Face-API.js Model Loader
 * Optimized for better performance in face authentication
 * This file provides a unified interface for loading face-api.js models
 * with caching, performance monitoring, and optimized settings
 */

// Global object to store face-api.js state
window.FaceAPI = {
  modelsLoaded: false,
  faceDetectionReady: false,
  modelLoadingPromise: null,
  modelPath: '/models',
  lastDetectionTime: 0,
  
  // Cache to avoid recreating detection options
  tinyFaceDetectorOptions: null,
  
  // Performance metrics
  metrics: {
    modelLoadTime: 0,
    detectionTimes: [],
    averageDetectionTime: 0
  },
  
  // Model configuration status
  models: {
    tinyFaceDetector: false,
    faceLandmark68Tiny: false,
    faceRecognition: false
  }
};

// Loader object with optimized methods
window.FaceAPILoader = {
  /**
   * Load face-api.js models with caching and optimizations
   * @param {Function} progressCallback - Progress update callback
   * @param {Object} options - Loading options
   * @returns {Promise} - Promise that resolves when models are loaded
   */
  loadFaceApiModels: async function(progressCallback = () => {}, options = {}) {
    // If models are already loading, return the existing promise
    if (window.FaceAPI.modelLoadingPromise) {
      return window.FaceAPI.modelLoadingPromise;
    }
    
    // If models are already loaded, just return resolved promise
    if (window.FaceAPI.faceDetectionReady) {
      progressCallback(100);
      return Promise.resolve();
    }
    
    console.time('modelLoading');
    
    // Create a new loading promise
    window.FaceAPI.modelLoadingPromise = new Promise(async (resolve, reject) => {
      try {
        // Update progress
        progressCallback(10);
        
        // Prefer CDN paths if available for faster loading
        const modelPath = window.FaceAPI.modelPath;
        
        // Set optimization options
        const useOptimizedModels = options.useOptimizedModels !== undefined ? 
          options.useOptimizedModels : true;
        const skipExpressions = options.skipExpressions !== undefined ?
          options.skipExpressions : true;
        const preferredFaceDetector = options.preferredFaceDetector || 'tiny';
  
        // Load TinyFaceDetector first for faster initial detection
        progressCallback(20);
        await faceapi.nets.tinyFaceDetector.load(modelPath);
        window.FaceAPI.models.tinyFaceDetector = true;
        progressCallback(50);
        
        // Load minimal models in parallel for faster initialization
        const remainingLoads = [
          faceapi.nets.faceLandmark68TinyNet.load(modelPath)
            .then(() => {
              window.FaceAPI.models.faceLandmark68Tiny = true;
            }),
          faceapi.nets.faceRecognitionNet.load(modelPath)
            .then(() => {
              window.FaceAPI.models.faceRecognition = true;  
            })
        ];
        
        // Update progress during loading
        let progress = 50;
        const progressInterval = setInterval(() => {
          if (progress < 85) {
            progress += 5;
            progressCallback(progress);
          } else {
            clearInterval(progressInterval);
          }
        }, 100);
        
        // Wait for all models to load
        await Promise.all(remainingLoads);
        clearInterval(progressInterval);
        progressCallback(90);
        
        // Create pre-configured detector options
        window.FaceAPI.tinyFaceDetectorOptions = new faceapi.TinyFaceDetectorOptions({
          inputSize: 128,
          scoreThreshold: 0.4
        });
        
        // Update state and finish
        window.FaceAPI.modelsLoaded = true;
        window.FaceAPI.faceDetectionReady = true;
        window.FaceAPI.modelLoadingPromise = null;
        
        console.timeEnd('modelLoading');
        
        // Store performance metrics
        window.FaceAPI.metrics.modelLoadTime = performance.now();
        
        // Warm up detector
        try {
          await this._warmupDetector();
        } catch (e) {
          console.warn('Detector warmup failed:', e);
        }
        
        // Dispatch event for other components
        window.dispatchEvent(new Event('faceApiModelsLoaded'));
        progressCallback(100);
        resolve();
        
      } catch (error) {
        console.error('Error loading face-api.js models:', error);
        window.FaceAPI.modelLoadingPromise = null;
        reject(error);
      }
    });
    
    return window.FaceAPI.modelLoadingPromise;
  },
  
  /**
   * Force reload models (useful for recovery after errors)
   * @param {Function} progressCallback - Progress update callback
   * @returns {Promise} - Promise that resolves when models are reloaded
   */
  forceReloadModels: async function(progressCallback = () => {}) {
    // Reset state
    window.FaceAPI.modelsLoaded = false;
    window.FaceAPI.faceDetectionReady = false;
    window.FaceAPI.modelLoadingPromise = null;
    
    // Force browser to reload models from server
    try {
      // Clear face-api internal state if possible
      if (faceapi.nets) {
        Object.keys(faceapi.nets).forEach(key => {
          if (faceapi.nets[key] && faceapi.nets[key].isLoaded) {
            try { faceapi.nets[key].isLoaded = false; } catch (e) {}
          }
        });
      }
    } catch (e) {
      console.warn('Could not reset internal face-api state:', e);
    }
    
    // Reload models
    return this.loadFaceApiModels(progressCallback);
  },
  
  /**
   * Optimized face detection function
   * @param {HTMLElement} input - Video or image element
   * @param {Object} options - Detection options
   * @returns {Promise<Array>} - Promise that resolves with detected faces
   */
  detectFaces: async function(input, options = {}) {
    // Ensure models are loaded
    if (!window.FaceAPI.faceDetectionReady) {
      await this.loadFaceApiModels();
    }
    
    const startTime = performance.now();
    
    // Get options with good defaults for performance
    const detectionOptions = window.FaceAPI.tinyFaceDetectorOptions || 
      new faceapi.TinyFaceDetectorOptions({
        inputSize: options.inputSize || 128,
        scoreThreshold: options.scoreThreshold || 0.4
      });
      
    // Detect faces
    const result = await faceapi.detectAllFaces(input, detectionOptions);
    
    // Track performance
    const endTime = performance.now();
    const detectionTime = endTime - startTime;
    
    // Update metrics
    window.FaceAPI.metrics.detectionTimes.push(detectionTime);
    if (window.FaceAPI.metrics.detectionTimes.length > 30) {
      window.FaceAPI.metrics.detectionTimes.shift();
    }
    
    // Calculate average
    const sum = window.FaceAPI.metrics.detectionTimes.reduce((a, b) => a + b, 0);
    window.FaceAPI.metrics.averageDetectionTime = sum / window.FaceAPI.metrics.detectionTimes.length;
    
    // Update last detection time
    window.FaceAPI.lastDetectionTime = Date.now();
    
    return result;
  },
  
  /**
   * Get full face detection with landmarks and descriptor
   * Used for authentication - more CPU intensive
   */
  detectFaceWithDescriptor: async function(imageElement) {
    if (!window.FaceAPI.faceDetectionReady) {
      await this.loadFaceApiModels();
    }
    
    try {
      return await faceapi.detectSingleFace(
        imageElement,
        window.FaceAPI.tinyFaceDetectorOptions
      )
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    } catch (error) {
      console.error('Face descriptor extraction error:', error.message);
      return null;
    }
  },
  
  /**
   * Internal method to warm up detector for faster first inference
   */
  _warmupDetector: async function() {
    // Create a simple test canvas
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 100, 100);
    
    // Draw a simple face-like shape
    ctx.fillStyle = '#dddddd';
    ctx.beginPath();
    ctx.ellipse(50, 50, 25, 35, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Run detection on this canvas
    try {
      await faceapi.detectSingleFace(
        canvas,
        window.FaceAPI.tinyFaceDetectorOptions
      );
      console.log('Face detector warmed up');
    } catch(e) {
      console.warn('Warmup error:', e);
    }
  },
  
  /**
   * Get debug information about model loading status
   */
  debugModelStatus: function() {
    return {
      modelsLoaded: window.FaceAPI.modelsLoaded,
      faceDetectionReady: window.FaceAPI.faceDetectionReady,
      isLoading: !!window.FaceAPI.modelLoadingPromise,
      modelStates: {
        tinyFaceDetector: window.FaceAPI.models.tinyFaceDetector,
        faceLandmark68Tiny: window.FaceAPI.models.faceLandmark68Tiny,
        faceRecognition: window.FaceAPI.models.faceRecognition
      },
      performance: {
        modelLoadTime: window.FaceAPI.metrics.modelLoadTime,
        averageDetectionTime: window.FaceAPI.metrics.averageDetectionTime.toFixed(2) + 'ms',
        lastDetection: window.FaceAPI.lastDetectionTime ? 
          new Date(window.FaceAPI.lastDetectionTime).toLocaleTimeString() : 'never'
      }
    };
  }
};