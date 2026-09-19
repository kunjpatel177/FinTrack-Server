const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');
const Goal = require('../models/Goal');

// @desc    Get dashboard summary metrics and quick widgets
// @route   GET /api/v1/dashboard/summary
// @access  Private
const getDashboardSummary = async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const currentDate = new Date();
    const month = parseInt(req.query.month, 10) || currentDate.getMonth() + 1;
    const year = parseInt(req.query.year, 10) || currentDate.getFullYear();

    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    // Fetch user starting balance
    const user = await User.findById(userId);
    const startingBalance = user?.startingBalance || 0;

    // 1. All-time Totals for Net Balance
    const allTimeResult = await Transaction.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: {
            type: '$type',
            isRefund: { $ifNull: ['$isRefund', false] },
          },
          total: { $sum: '$amount' },
        },
      },
    ]);

    let totalAllTimeIncome = 0;
    let totalAllTimeExpense = 0;
    allTimeResult.forEach((item) => {
      if (item._id.type === 'income') {
        totalAllTimeIncome += item.total;
      } else if (item._id.type === 'expense') {
        if (item._id.isRefund) {
          totalAllTimeExpense -= item.total;
        } else {
          totalAllTimeExpense += item.total;
        }
      }
    });
    const totalBalance = startingBalance + totalAllTimeIncome - totalAllTimeExpense;

    // 2. Monthly Income & Expense
    const monthlyResult = await Transaction.aggregate([
      {
        $match: {
          user: userId,
          date: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: {
            type: '$type',
            isRefund: { $ifNull: ['$isRefund', false] },
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    let monthlyIncome = 0;
    let monthlyRegularExpense = 0;
    let monthlyRefundExpense = 0;
    let monthlyTransactionCount = 0;

    monthlyResult.forEach((item) => {
      monthlyTransactionCount += item.count;
      if (item._id.type === 'income') {
        monthlyIncome += item.total;
      } else if (item._id.type === 'expense') {
        if (item._id.isRefund) {
          monthlyRefundExpense += item.total;
        } else {
          monthlyRegularExpense += item.total;
        }
      }
    });

    const monthlyExpense = Math.max(0, monthlyRegularExpense - monthlyRefundExpense);
    const netSavings = monthlyIncome - monthlyRegularExpense + monthlyRefundExpense;
    const savingsRate = monthlyIncome > 0 ? Math.round((netSavings / monthlyIncome) * 100) : 0;

    // 3. Monthly Budget Usage Summary
    const budgets = await Budget.find({ user: userId, month, year }).populate('category', 'name color');
    let totalBudgetAmount = 0;
    budgets.forEach((b) => {
      totalBudgetAmount += b.amount;
    });

    // Calculate budget utilization
    const budgetUsagePercent = totalBudgetAmount > 0
      ? Math.min(Math.round((monthlyExpense / totalBudgetAmount) * 100), 1000)
      : 0;

    // 4. Recent 5 Transactions
    const recentTransactions = await Transaction.find({ user: userId })
      .populate('category', 'name type icon color')
      .sort({ date: -1 })
      .limit(5);

    // 5. Goals progress snapshot
    const goals = await Goal.find({ user: userId, status: 'in_progress' })
      .sort({ targetDate: 1 })
      .limit(3);

    const goalsSnapshot = goals.map((g) => ({
      id: g._id,
      name: g.name,
      targetAmount: g.targetAmount,
      currentSavedAmount: g.currentSavedAmount,
      progressPercentage: Math.min(
        Math.round((g.currentSavedAmount / g.targetAmount) * 100),
        100
      ),
      targetDate: g.targetDate,
    }));

    res.status(200).json({
      success: true,
      data: {
        filter: { month, year },
        startingBalance,
        totalBalance,
        monthlyIncome,
        monthlyExpense,
        netSavings,
        savingsRate,
        monthlyTransactionCount,
        budgetSummary: {
          totalBudget: totalBudgetAmount,
          totalSpent: monthlyExpense,
          remaining: Math.max(0, totalBudgetAmount - monthlyExpense),
          percentage: budgetUsagePercent,
          status:
            totalBudgetAmount === 0
              ? 'not_set'
              : monthlyExpense > totalBudgetAmount
              ? 'exceeded'
              : budgetUsagePercent >= 80
              ? 'warning'
              : 'healthy',
        },
        recentTransactions,
        goalsSnapshot,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get chart analytics for dashboard
// @route   GET /api/v1/dashboard/charts
// @access  Private
const getDashboardCharts = async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const currentDate = new Date();
    const month = parseInt(req.query.month, 10) || currentDate.getMonth() + 1;
    const year = parseInt(req.query.year, 10) || currentDate.getFullYear();

    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    // 1. Spending by Category for selected month (Donut / Pie chart)
    const categorySpending = await Transaction.aggregate([
      {
        $match: {
          user: userId,
          type: 'expense',
          date: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: '$category',
          totalAmount: {
            $sum: {
              $cond: [
                { $eq: ['$isRefund', true] },
                { $multiply: ['$amount', -1] },
                '$amount',
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'categoryDetails',
        },
      },
      { $unwind: '$categoryDetails' },
      {
        $project: {
          categoryId: '$_id',
          name: '$categoryDetails.name',
          color: '$categoryDetails.color',
          icon: '$categoryDetails.icon',
          amount: { $max: [0, '$totalAmount'] },
          count: '$count',
        },
      },
      { $match: { amount: { $gt: 0 } } },
      { $sort: { amount: -1 } },
    ]);

    // 2. Past 6 Months Monthly Trend (Income vs Expense Line/Area chart)
    const past6MonthsStart = new Date(year, month - 6, 1);
    const monthlyTrendData = await Transaction.aggregate([
      {
        $match: {
          user: userId,
          date: { $gte: past6MonthsStart, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' },
            type: '$type',
          },
          total: {
            $sum: {
              $cond: [
                { $eq: ['$isRefund', true] },
                { $multiply: ['$amount', -1] },
                '$amount',
              ],
            },
          },
        },
      },
      {
        $group: {
          _id: { year: '$_id.year', month: '$_id.month' },
          data: {
            $push: {
              type: '$_id.type',
              total: '$total',
            },
          },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Map month names
    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];

    const formattedTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const monthLabel = `${monthNames[m - 1]} ${y.toString().slice(-2)}`;

      const found = monthlyTrendData.find(
        (item) => item._id.year === y && item._id.month === m
      );

      let inc = 0;
      let exp = 0;
      if (found) {
        found.data.forEach((dItem) => {
          if (dItem.type === 'income') inc = dItem.total;
          if (dItem.type === 'expense') exp = dItem.total;
        });
      }

      formattedTrend.push({
        month: monthLabel,
        year: y,
        monthNum: m,
        income: inc,
        expense: exp,
        net: inc - exp,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        categorySpending,
        monthlyTrend: formattedTrend,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardSummary,
  getDashboardCharts,
};
