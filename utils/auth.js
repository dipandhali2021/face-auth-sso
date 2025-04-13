import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Generates a random string of specified length
 * @param {number} length - Length of the random string
 * @returns {string} - Random hex string
 */
export function generateRandomString(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generates a JWT token with provided payload
 * @param {Object} payload - Token payload
 * @param {string} expiresIn - Token expiration time
 * @returns {string} - JWT token
 */
export function generateJWT(payload, expiresIn = '1h') {
  const secret = process.env.SESSION_SECRET;
  // Check if payload already has an 'exp' property to avoid conflict with expiresIn option
  const options = payload.exp ? {} : { expiresIn };
  return jwt.sign(payload, secret, options);
}

/**
 * Verifies a JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object|null} - Decoded token payload or null if invalid
 */
export function verifyJWT(token) {
  const secret = process.env.SESSION_SECRET;
  try {
    return jwt.verify(token, secret);
  } catch (error) {
    return null;
  }
}