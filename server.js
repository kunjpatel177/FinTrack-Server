const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = require('./app');
const connectDB = require('./config/db');
const { processDueRecurringTransactions } = require('./services/recurringService');

// Connect to Database
connectDB();

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(` FinTrack Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(` API URL: http://localhost:${PORT}/api/v1`);
  console.log(`===============================================`);

  // Run initial recurring transactions check on boot
  try {
    const result = await processDueRecurringTransactions();
    if (result.processedCount > 0) {
      console.log(`[Recurring Service] Processed ${result.processedCount} due recurring transactions on startup.`);
    }
  } catch (err) {
    console.error(`[Recurring Service Error]: ${err.message}`);
  }

  // Periodic recurring check every 1 hour (3,600,000 ms)
  setInterval(async () => {
    try {
      const result = await processDueRecurringTransactions();
      if (result.processedCount > 0) {
        console.log(`[Recurring Service] Processed ${result.processedCount} due recurring transactions.`);
      }
    } catch (err) {
      console.error(`[Recurring Service Interval Error]: ${err.message}`);
    }
  }, 60 * 60 * 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
  // Don't kill server immediately in dev, just log
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error(`Uncaught Exception: ${err.message}`);
});
