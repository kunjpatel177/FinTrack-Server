const mongoose = require('mongoose');

// Global cache to maintain and reuse a single database connection
// across requests and hot-reloads in serverless / cloud environments (e.g. Vercel)
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    const errorMsg =
      'MONGO_URI is not defined in environment variables! ' +
      'Please configure MONGO_URI in your deployment settings (e.g. Vercel Dashboard -> Settings -> Environment Variables).';
    console.error(`[MongoDB Configuration Error]: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // If already connected, reuse existing connection immediately
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // If connection object is cached and active
  if (cached.conn && cached.conn.readyState === 1) {
    return cached.conn;
  }

  // If a connection attempt is in progress, wait for it
  if (!cached.promise) {
    const opts = {
      serverSelectionTimeoutMS: 8000, // Fail after 8s instead of hanging indefinitely
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
    };

    console.log('[MongoDB]: Initiating connection to database...');
    cached.promise = mongoose
      .connect(mongoUri, opts)
      .then((mongooseInstance) => {
        console.log(`[MongoDB Connected]: ${mongooseInstance.connection.host}/${mongooseInstance.connection.name}`);
        return mongooseInstance.connection;
      })
      .catch((err) => {
        cached.promise = null; // Clear so subsequent requests can re-attempt
        console.error(`[MongoDB Connection Error]: ${err.message}`);
        throw err;
      });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.promise = null;
    throw error;
  }
};

module.exports = connectDB;
