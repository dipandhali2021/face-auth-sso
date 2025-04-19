import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { clients } from '../config/oauth.js';
import { generateRandomString, generateJWT, verifyJWT } from '../utils/auth.js';
import { User, FaceProfile, Token, AuthCode } from '../utils/db.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OIDC Discovery Endpoint
router.get('/.well-known/openid-configuration', (req, res) => {
  // Use the request's origin or forwarded host to determine the base URL
  const baseUrl = req.headers['x-forwarded-host']
    ? `${req.headers['x-forwarded-proto'] || req.protocol}://${
        req.headers['x-forwarded-host']
      }`
    : `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
    jwks_uri: `${baseUrl}/oauth/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256', 'RS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
    ],
    claims_supported: [
      'sub',
      'iss',
      'name',
      'picture',
      'face_verified',
      'email',
    ],
    registration_endpoint: `${baseUrl}/oauth/register`,
    end_session_endpoint: `${baseUrl}/oauth/logout`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    introspection_endpoint: `${baseUrl}/oauth/introspect`,
    check_session_iframe: `${baseUrl}/oauth/session-check`,
  });
});

// Client Registration Endpoint
router.post('/register', (req, res) => {
  const { client_name, redirect_uris, grant_types, response_types, scope } =
    req.body;

  if (
    !client_name ||
    !redirect_uris ||
    !Array.isArray(redirect_uris) ||
    redirect_uris.length === 0
  ) {
    return res.status(400).json({ error: 'invalid_client_metadata' });
  }

  const clientId = `client-${generateRandomString(8)}`;
  const clientSecret = generateRandomString();

  clients[clientId] = {
    clientId,
    clientSecret,
    clientName: client_name,
    redirectUris: redirect_uris,
    grants: grant_types || ['authorization_code'],
    responseTypes: response_types || ['code'],
    scopes: scope ? scope.split(' ') : ['openid', 'profile'],
  };

  res.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0, // Never expires
    redirect_uris,
    grant_types: clients[clientId].grants,
    response_types: clients[clientId].responseTypes,
    token_endpoint_auth_method: 'client_secret_basic',
  });
});

// Authorization Endpoint
router.get('/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state } = req.query;

  // Validate request parameters
  const client = clients[client_id];
  if (!client) {
    return res.redirect(
      `${redirect_uri}?error=invalid_client&error_description=Invalid client identifier&state=${
        state || ''
      }`
    );
  }

  if (!client.redirectUris.includes(redirect_uri)) {
    return res.redirect(
      `${redirect_uri}?error=invalid_redirect_uri&error_description=Invalid redirection URI&state=${
        state || ''
      }`
    );
  }

  if (response_type !== 'code') {
    return res.redirect(
      `${redirect_uri}?error=unsupported_response_type&error_description=Unsupported response type&state=${
        state || ''
      }`
    );
  }

  // Store the authorization request details
  const authRequest = {
    clientId: client_id,
    redirectUri: redirect_uri,
    scope: scope || '',
    state: state || '',
  };

  // Read the HTML file and replace the placeholder with the request data
  const authorizePage = fs.readFileSync(
    path.join(process.cwd(), 'public', 'authorize.html'),
    'utf8'
  );
  const renderedPage = authorizePage.replace(
    '{{requestData}}',
    Buffer.from(JSON.stringify(authRequest)).toString('base64')
  );

  res.send(renderedPage);
});

// Token Endpoint
router.post('/token', async (req, res) => {
  const { grant_type, code, redirect_uri, client_id, client_secret } = req.body;

  // Validate client credentials
  const client = clients[client_id];
  if (!client || client.clientSecret !== client_secret) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // Handle refresh token grant
  if (grant_type === 'refresh_token') {
    const { refresh_token } = req.body;
    const refreshTokenDoc = await Token.findOne({
      token: refresh_token,
      isRefreshToken: true,
    });

    if (!refreshTokenDoc || refreshTokenDoc.expiresAt < new Date()) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    await Token.deleteOne({ token: refresh_token });

    // Generate new tokens
    const accessToken = generateRandomString();
    const refreshToken = generateRandomString();
    const accessTokenExpires = new Date(Date.now() + 3600 * 1000);
    const refreshTokenExpires = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    // Store new tokens
    await Promise.all([
      new Token({
        token: accessToken,
        userId: refreshTokenDoc.userId,
        clientId: client_id,
        scope: refreshTokenDoc.scope,
        expiresAt: accessTokenExpires,
      }).save(),
      new Token({
        token: refreshToken,
        userId: refreshTokenDoc.userId,
        clientId: client_id,
        scope: refreshTokenDoc.scope,
        isRefreshToken: true,
        expiresAt: refreshTokenExpires,
      }).save(),
    ]);

    // Return new tokens
    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: refreshToken,
      refresh_expires_in: 604800,
      id_token: generateJWT({
        sub: refreshTokenDoc.userId,
        iss: req.headers['x-forwarded-host']
          ? `${req.headers['x-forwarded-proto'] || req.protocol}://${
              req.headers['x-forwarded-host']
            }`
          : `${req.protocol}://${req.get('host')}`,
        exp: Math.floor(accessTokenExpires.getTime() / 1000),
      }),
    });
  }

  // Validate authorization code grant type
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  try {
    // Validate authorization code from MongoDB
    const authCodeData = await AuthCode.findOne({ code: code });
    if (
      !authCodeData ||
      authCodeData.clientId !== client_id ||
      authCodeData.redirectUri !== redirect_uri ||
      authCodeData.expiresAt < new Date()
    ) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    // Delete the used authorization code
    await AuthCode.deleteOne({ code: code });

    // Get user data from MongoDB
    let user = await User.findOne({ id: authCodeData.userId });

    if (!user) {
      // If user not found, create a default user (shouldn't happen in normal flow)
      user = {
        id: authCodeData.userId,
        name: `User ${authCodeData.userId.substring(0, 6)}`,
        email: `user-${authCodeData.userId.substring(0, 6)}@example.com`,
        faceVerified: true,
      };
    }

    // Generate access token and ID token
    const accessToken = generateRandomString();
    const refreshToken = generateRandomString();

    // Get face profile for the user from MongoDB
    const faceProfile = await FaceProfile.findOne({ userId: user.id });

    // Get profile picture URL (prefer Cloudinary URL if available)
    const profilePictureUrl =
      user.profilePicture ||
      (faceProfile
        ? `/uploads/${path.basename(faceProfile.faceImagePath)}`
        : null);

    const idToken = generateJWT({
      // Required OIDC claims
      iss: req.headers['x-forwarded-host']
        ? `${req.headers['x-forwarded-proto'] || req.protocol}://${
            req.headers['x-forwarded-host']
          }`
        : `${req.protocol}://${req.get('host')}`,
      sub: user.id,
      aud: client_id,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      auth_time: Math.floor(Date.now() / 1000),
      nonce: authCodeData.nonce,

      // Additional claims mapped to Clerk's attribute mapping
      name: user.name,
      given_name: user.firstName || 'User',
      family_name: user.lastName || user.id.substring(0, 6),
      email: user.email,
      email_verified:
        user.emailVerified !== undefined ? user.emailVerified : true,
      face_verified: user.faceVerified !== undefined ? user.faceVerified : true,
      picture: profilePictureUrl,
      updated_at:
        Math.floor(user.updatedAt?.getTime() / 1000) ||
        Math.floor(Date.now() / 1000),
    });

    // Store access token in MongoDB
    const accessTokenDoc = new Token({
      token: accessToken,
      userId: user.id,
      clientId: client_id,
      scope: authCodeData.scope,
      expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour
    });
    await accessTokenDoc.save();

    // Store refresh token in MongoDB
    const refreshTokenDoc = new Token({
      token: refreshToken,
      userId: user.id,
      clientId: client_id,
      scope: authCodeData.scope,
      isRefreshToken: true,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), // 30 days
    });
    await refreshTokenDoc.save();

    // Return tokens
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: refreshToken,
      refresh_expires_in: 604800,
      id_token: idToken,
    });
  } catch (error) {
    console.error('Error processing token request:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

// UserInfo Endpoint
router.get('/userinfo', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const accessToken = authHeader.substring(7);

  try {
    // Get token data from MongoDB
    const tokenData = await Token.findOne({
      token: accessToken,
      isRefreshToken: false,
    });

    if (!tokenData || tokenData.expiresAt < new Date()) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    // Get user data from MongoDB
    let user = await User.findOne({ id: tokenData.userId });

    if (!user) {
      // If user not found, create a default user (shouldn't happen in normal flow)
      user = {
        id: tokenData.userId,
        name: `User ${tokenData.userId.substring(0, 6)}`,
        firstName: 'User',
        lastName: tokenData.userId.substring(0, 6),
        email: `user-${tokenData.userId.substring(0, 6)}@example.com`,
        emailVerified: true,
        faceVerified: true,
      };
    }

    // Get face profile for the user
    const faceProfile = await FaceProfile.findOne({ userId: user.id });

    // Get profile picture URL (prefer user's profilePicture if available)
    const profilePictureUrl =
      user.profilePicture ||
      (faceProfile
        ? `/uploads/${path.basename(faceProfile.faceImagePath)}`
        : null);

    // Return user info with Clerk-compatible attributes
    res.json({
      sub: user.id,
      name: user.name,
      given_name: user.firstName || 'User',
      family_name: user.lastName || user.id.substring(0, 6),
      email: user.email,
      email_verified:
        user.emailVerified !== undefined ? user.emailVerified : true,
      face_verified: user.faceVerified !== undefined ? user.faceVerified : true,
      picture: profilePictureUrl,
      updated_at:
        Math.floor(user.updatedAt?.getTime() / 1000) ||
        Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    console.error('Error processing userinfo request:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

// Logout Endpoint
router.get('/logout', (req, res) => {
  // Clean up any temporary file references from the session
  if (req.session.tempFileName) {
    console.log('Temporary file reference cleared during logout');
    delete req.session.tempFileName;
  }
  
  // Clear session
  req.session.destroy();

  // Get post_logout_redirect_uri from query params
  const redirectUri =
    req.query.post_logout_redirect_uri || 'http://localhost:5000';

  res.redirect(redirectUri);
});

// JWKS Endpoint for OIDC compliance
router.get('/jwks', (req, res) => {
  const jwks = {
    keys: [
      {
        kty: 'oct',
        kid: '1',
        use: 'sig',
        alg: 'HS256',
        k: Buffer.from(process.env.SESSION_SECRET)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, ''),
      },
    ],
  };

  res.json(jwks);
});

// Token revocation endpoint
router.post('/revoke', async (req, res) => {
  const { token } = req.body;
  await Token.deleteOne({ token });
  res.status(200).end();
});

// Session management endpoints
router.get('/session', (req, res) => {
  res.json({
    client_id: req.session.clientId,
    user: req.session.userId,
    authenticated: !!req.session.authenticated,
    expires: req.session.cookie.expires,
  });
});

router.post('/backchannel-logout', async (req, res) => {
  const { logout_token } = req.body;
  const decoded = verifyJWT(logout_token);

  if (decoded?.sub) {
    await Token.deleteMany({ userId: decoded.sub });
    await AuthCode.deleteMany({ userId: decoded.sub });
  }
  res.status(204).end();
});

// Introspection endpoint (required for some OIDC clients)
router.post('/introspect', async (req, res) => {
  const { token, token_type_hint } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  try {
    // Get token data from MongoDB
    const tokenData = await Token.findOne({ token: token });

    if (!tokenData || tokenData.expiresAt < new Date()) {
      return res.json({ active: false });
    }

    // Get user data from MongoDB
    const user = await User.findOne({ id: tokenData.userId });

    res.json({
      active: true,
      client_id: tokenData.clientId,
      username: user ? user.name : undefined,
      scope: tokenData.scope,
      sub: tokenData.userId,
      exp: Math.floor(tokenData.expiresAt.getTime() / 1000),
      iat: Math.floor((tokenData.expiresAt.getTime() - 3600 * 1000) / 1000),
      token_type: tokenData.isRefreshToken ? 'refresh_token' : 'access_token',
    });
  } catch (error) {
    console.error('Error introspecting token:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;