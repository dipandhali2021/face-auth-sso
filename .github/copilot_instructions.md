# Face Auth SSO - GitHub Copilot Instructions

## Project Overview
Face Auth SSO is a facial authentication system that implements Single Sign-On (SSO) functionality using face recognition technology. The application allows users to register their faces and then log in using facial recognition, providing a passwordless authentication experience.

## Technology Stack

### Frontend
- **Framework**: React (v19.0.0)
- **Router**: React Router DOM (v7.5.0)
- **Face Recognition**: face-api.js (v0.22.2)
- **Build Tool**: Vite (v6.2.0)

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Authentication**: OAuth 2.0 / OpenID Connect
- **Database**: MongoDB (with Mongoose)
- **Media Storage**: Cloudinary
- **Face Recognition**: face-api.js (v0.22.2)

## Project Structure

- `/src`: Client-side React application
  - `/components`: React components including FaceRecognition and OAuthClient
  - `/assets`: Static assets
- `/server`: Express.js backend
  - `/public`: Static files served by backend, including HTML pages for authentication
  - `/utils`: Utility functions for face recognition, database, and media storage
- `/public`: Static files for the frontend, including ML models for face-api.js

## Key Features

1. **Facial Registration**: Users can register their faces for authentication
2. **Facial Authentication**: Login using facial recognition
3. **OAuth 2.0 / OpenID Connect**: Implementation of SSO protocols
4. **Face Detection & Analysis**: Uses face-api.js for face detection, recognition, and analysis
5. **Secure Token Management**: JWT-based authentication

## Best Practices

### Frontend
1. **Component Separation**: Keep components focused and separate (e.g., FaceRecognition and OAuthClient)
2. **React Hooks**: Use React hooks for state management and side effects
3. **Responsive Design**: Ensure UI works across device sizes
4. **Error Handling**: Implement comprehensive error states for the face recognition process

### Backend
1. **Environment Variables**: Store sensitive information in .env files (not in code)
2. **Security**: Follow OAuth 2.0 best practices for secure token exchange
3. **API Structure**: Use RESTful API design patterns
4. **Error Handling**: Implement proper try/catch blocks and error responses

### Face Recognition
1. **Model Loading**: Load face-api.js models efficiently
2. **User Experience**: Provide clear feedback during face detection and matching
3. **Performance**: Optimize face detection parameters for better performance
4. **Privacy**: Handle biometric data securely

## Common Tasks

### Adding New Face Recognition Features
1. Import required models from face-api.js
2. Update the FaceRecognition component to use new features
3. Implement corresponding backend endpoints in the server

### Extending OAuth Functionality
1. Update the OAuthClient component for new auth flows
2. Implement required endpoints on the server
3. Ensure proper token validation and security measures

### Debugging
1. Check browser console for face-api.js errors
2. Verify camera access permissions
3. Check network requests for OAuth token exchange issues
4. Confirm MongoDB connection and data structure

## Development Workflow
1. Run client: `npm run dev` in the root directory
2. Run server: `npm run dev` in the server directory
3. For production: Build client with `npm run build` and start the server with `npm start`

## Dependencies Management
1. Update dependencies with caution, especially face-api.js
2. Test thoroughly after updates to React or face-api.js versions
3. Keep Node.js backend and frontend dependencies in sync where relevant

## Security Considerations
1. Never expose client secrets in frontend code
2. Implement proper CORS settings on the backend
3. Store face data securely and in compliance with privacy regulations
4. Use HTTPS for all API communications
5. Implement rate limiting for face recognition attempts
6. Consider implementing liveness detection to prevent spoofing attacks

## Performance Considerations
1. Optimize face-api.js model loading (consider workers for intensive operations)
2. Implement proper caching strategies for API responses
3. Optimize image capture and processing for face recognition
4. Consider using WebAssembly versions of face recognition libraries for better performance

## Using Web Search for Latest Documentation

### Using #web_search in Prompts
You can leverage the SearXNG web search tool in Model Context Protocol (MCP) by including the `#web_search` tag in your prompts to GitHub Copilot. This allows you to pull in the latest documentation, guides, and code examples from the internet.

#### How to Use Web Search
1. Add the `#web_search` tag at the end of your prompt to activate the web search functionality
2. Be specific with your query to get the most relevant results
3. Format your prompt clearly to search for exactly what you need

#### Examples

```
Show me how to implement liveness detection with face-api.js #web_search
```

```
What's the latest approach for storing JWT tokens securely in React 19? #web_search
```

```
Get updated examples of OAuth 2.0 flows with Node.js and Express #web_search
```

### Benefits of Using Web Search
1. **Up-to-date Documentation**: Access the latest documentation for face-api.js and other libraries even if the project uses older versions
2. **Best Practices**: Find current security and performance best practices for facial recognition and authentication systems
3. **Troubleshooting**: Search for solutions to specific issues you encounter during development
4. **Library Updates**: Check for newer versions of libraries and their migration guides

### Tips for Effective Searches
1. Include library names and version numbers in your search
2. Use technical terminology specific to face recognition and OAuth
3. Specify the programming language (JavaScript/TypeScript) and framework (React/Node.js)
4. For security-related questions, include the year to get current recommendations

### Integrating Search Results
When implementing features based on search results:
1. Adapt code examples to match the project's structure and conventions
2. Consider compatibility with the existing authentication flow
3. Test thoroughly, especially for security-critical components
4. Document any new approaches or techniques used based on search results