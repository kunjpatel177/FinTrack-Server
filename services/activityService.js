const ActivityLog = require('../models/ActivityLog');

const logActivity = async (userId, action, description, metadata = {}) => {
  try {
    if (!userId) return;
    await ActivityLog.create({
      user: userId,
      action,
      description,
      metadata,
      createdAt: new Date(),
    });
  } catch (err) {
    // Non-blocking error for activity logs
    console.error('Failed to log activity:', err.message);
  }
};

module.exports = { logActivity };
