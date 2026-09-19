const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const errorHandler = require('./middleware/error');

// Route files
const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const budgetRoutes = require('./routes/budgetRoutes');
const recurringRoutes = require('./routes/recurringRoutes');
const goalRoutes = require('./routes/goalRoutes');
const householdRoutes = require('./routes/householdRoutes');
const reportRoutes = require('./routes/reportRoutes');
const activityRoutes = require('./routes/activityRoutes');

const app = express();

// Allowed origins configuration
const defaultAllowedOrigins = [
  'https://fintrackltd.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000',
];

// Clean and normalize CLIENT_URL from environment (strip trailing slashes, support comma separation)
const envOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((url) => url.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envOrigins]));

const isOriginAllowed = (origin) => {
  // Allow requests with no origin (e.g. mobile apps, curl, server-to-server, Postman)
  if (!origin) return true;

  // Clean trailing slash from incoming origin
  const cleanOrigin = origin.trim().replace(/\/+$/, '');

  // Direct match with allowed origins
  if (allowedOrigins.includes(cleanOrigin)) return true;

  // Match all FinTrack Vercel deployments (production, previews, branch deploys)
  if (/^https:\/\/fintrack[a-z0-9-]*\.vercel\.app$/i.test(cleanOrigin)) return true;
  if (/^https:\/\/fin-track[a-z0-9-]*\.vercel\.app$/i.test(cleanOrigin)) return true;

  // Match localhost / local IP on any port
  if (/^http:\/\/localhost(:\d+)?$/i.test(cleanOrigin)) return true;
  if (/^http:\/\/127\.0\.0\.1(:\d+)?$/i.test(cleanOrigin)) return true;

  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      // Echoing back the exact incoming origin (without trailing slash) satisfies
      // browser security requirements when credentials: true.
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
  ],
  exposedHeaders: ['Content-Disposition'],
  optionsSuccessStatus: 200,
};

// Enable CORS first so preflight OPTIONS and cross-origin headers are always attached
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Security HTTP headers (configured to permit cross-origin resource requests)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dev logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    app: 'FinTrack API',
  });
});

// Mount routers
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/budgets', budgetRoutes);
app.use('/api/v1/recurring', recurringRoutes);
app.use('/api/v1/goals', goalRoutes);
app.use('/api/v1/household', householdRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/activities', activityRoutes);

// Catch-all 404 handler for undefined API routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint ${req.originalUrl} not found`,
  });
});

// Centralized error handler
app.use(errorHandler);

module.exports = app;
