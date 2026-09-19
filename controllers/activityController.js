const ActivityLog = require('../models/ActivityLog');

// @desc    Get user's activity logs
// @route   GET /api/v1/activities
// @access  Private
const getActivities = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 15;
    const skip = (page - 1) * limit;

    const filter = { user: req.user.id };
    if (req.query.action) {
      filter.action = req.query.action;
    }

    const totalCount = await ActivityLog.countDocuments(filter);
    const activities = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      data: activities,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Clear activity logs
// @route   DELETE /api/v1/activities
// @access  Private
const clearActivities = async (req, res, next) => {
  try {
    await ActivityLog.deleteMany({ user: req.user.id });

    res.status(200).json({
      success: true,
      message: 'Activity history cleared',
      data: {},
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getActivities,
  clearActivities,
};
