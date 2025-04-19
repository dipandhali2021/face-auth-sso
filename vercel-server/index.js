import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { connectDB } from './utils/db.js';
import * as faceRecognition from './utils/faceRecognition.js';

// Import routes
import oauthRoutes from './routes/oauth.js';
import faceAuthRoutes from './routes/face-auth.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/users.js';
import apiRoutes from './routes/api.js';

// Import middleware
import { cleanupTempFiles } from './middleware/auth.js';

// ES Module dirname equivalent
const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();

// Parse command line arguments for port
const args = process.argv.slice(2);
let PORT = process.env.PORT || 5000; // Default port

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && i + 1 < args.length) {
    PORT = parseInt(args[i + 1], 10);
    break;
  }
}

// Middleware setup
app.use(
  cors({
    origin: true, // Allow requests from any origin with credentials
    credentials: true,
  })
);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

// Session middleware for maintaining login state
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
  })
);

// Custom middleware for file cleanup during redirects
app.use(cleanupTempFiles);

// Connect to MongoDB
connectDB()
  .then(() => {
    console.log('Connected to MongoDB for OAuth server');
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
  });

// OIDC Discovery Endpoint (This has to be in the root since it's a well-known URL)
app.use('/', oauthRoutes);

// Mount routes
app.use('/oauth', oauthRoutes);
app.use('/face-auth', faceAuthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/', userRoutes);

// Endpoint to serve face-api.js models
app.use('/models', express.static(path.join(__dirname, 'public', 'models')));

// Initialize face-api.js models
faceRecognition.loadModels()
  .then(() => {
    console.log('Face-api.js models loaded successfully in server');
  })
  .catch((err) => {
    console.error('Failed to load face-api.js models:', err);
  });

// Connect to MongoDB and start the server
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `OAuth 2.0 Server with Face Authentication is running on http://localhost:${PORT}`
      );
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
  });
