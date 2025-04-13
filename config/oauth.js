import dotenv from 'dotenv';

dotenv.config();

// OAuth clients configuration
export const clients = {
  'face-auth-client': {
    clientId: 'face-auth-client',
    clientSecret:
      'd8aa5334cf7f03526f438db137b82809f3bd0847961e833e6d05c04f6def49f5',
    redirectUris: [
      'http://localhost:5173/oauth/callback',  // Vite development server
      'http://localhost:5001/oauth/callback',  // OAuth server
      'https://dapi.clerk.com/v1/oauth_debug/callback',
      'https://prime-stallion-8.clerk.accounts.dev/v1/oauth_callback'
    ],
    grants: ['authorization_code'],
    scopes: ['openid', 'profile'],
  },
};