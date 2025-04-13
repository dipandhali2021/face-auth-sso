import dotenv from 'dotenv';

dotenv.config();

/**
 * Admin authentication middleware for secure endpoints
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const authenticateAdmin = (req, res, next) => {
  const adminToken = req.headers['x-admin-token'];
  const validAdminToken = process.env.ADMIN_SECRET_TOKEN || 'extremely-secret-admin-token-for-development-only';
  
  if (!adminToken || adminToken !== validAdminToken) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid admin token' });
  }
  
  next();
};

/**
 * Middleware to clean up temporary files when redirecting to error pages
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const cleanupTempFiles = (req, res, next) => {
  // Store the original redirect method
  const originalRedirect = res.redirect;

  // Override the redirect method
  res.redirect = function (url) {
    // If there's a temporary file path in the session, try to delete it
    if (req.session && req.session.tempFilePath) {
      try {
        console.log('Temporary file reference cleared during redirect');
        // Clear the temporary file path from session
        delete req.session.tempFilePath;
      } catch (error) {
        console.error('Error cleaning up during redirect:', error);
      }
    }

    // Call the original redirect method
    return originalRedirect.apply(this, arguments);
  };

  next();
};