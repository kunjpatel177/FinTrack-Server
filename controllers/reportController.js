const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');

// @desc    Get detailed financial report analytics
// @route   GET /api/v1/reports/analytics
// @access  Private
const getReportAnalytics = async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const { timeframe = '6months', startDate, endDate } = req.query;

    const now = new Date();
    let start;
    let end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    } else {
      switch (timeframe) {
        case '1month':
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case '3months':
          start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
          break;
        case '1year':
          start = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
          break;
        case 'all':
          start = new Date(2020, 0, 1);
          break;
        case '6months':
        default:
          start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
          break;
      }
    }

    const matchFilter = {
      user: userId,
      date: { $gte: start, $lte: end },
    };

    // 1. Overall Summary Totals
    const overallStats = await Transaction.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            type: '$type',
            isRefund: { $ifNull: ['$isRefund', false] },
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
          maxAmount: { $max: '$amount' },
        },
      },
    ]);

    let totalIncome = 0;
    let regularExpense = 0;
    let refundExpense = 0;
    let txCount = 0;
    let maxExpense = 0;

    overallStats.forEach((s) => {
      txCount += s.count;
      if (s._id.type === 'income') totalIncome += s.total;
      if (s._id.type === 'expense') {
        if (s._id.isRefund) {
          refundExpense += s.total;
        } else {
          regularExpense += s.total;
          maxExpense = Math.max(maxExpense, s.maxAmount || 0);
        }
      }
    });

    const totalExpense = Math.max(0, regularExpense - refundExpense);
    const netSavings = totalIncome - regularExpense + refundExpense;
    const savingsRate = totalIncome > 0 ? Math.round((netSavings / totalIncome) * 100) : 0;

    // Calculate approximate month count
    const monthDiff = Math.max(
      1,
      (end.getFullYear() - start.getFullYear()) * 12 +
        (end.getMonth() - start.getMonth()) +
        1
    );
    const avgMonthlyExpense = Math.round(totalExpense / monthDiff);
    const avgMonthlyIncome = Math.round(totalIncome / monthDiff);

    // 2. Monthly Income vs Expense Breakdown
    const monthlyBreakdown = await Transaction.aggregate([
      { $match: matchFilter },
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
          types: {
            $push: {
              type: '$_id.type',
              total: '$total',
            },
          },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];

    const monthlyTrends = monthlyBreakdown.map((m) => {
      let inc = 0;
      let exp = 0;
      m.types.forEach((t) => {
        if (t.type === 'income') inc = t.total;
        if (t.type === 'expense') exp = t.total;
      });
      return {
        month: `${monthNames[m._id.month - 1]} ${m._id.year.toString().slice(-2)}`,
        year: m._id.year,
        monthNum: m._id.month,
        income: inc,
        expense: exp,
        savings: inc - exp,
        savingsRate: inc > 0 ? Math.round(((inc - exp) / inc) * 100) : 0,
      };
    });

    // 3. Category-wise Spending
    const categorySpending = await Transaction.aggregate([
      { $match: { ...matchFilter, type: 'expense' } },
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

    const formattedCategorySpending = categorySpending.map((cat) => ({
      ...cat,
      percentage: totalExpense > 0 ? Math.round((cat.amount / totalExpense) * 100) : 0,
    }));

    // 4. Category-wise Income
    const categoryIncome = await Transaction.aggregate([
      { $match: { ...matchFilter, type: 'income' } },
      {
        $group: {
          _id: '$category',
          totalAmount: { $sum: '$amount' },
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
          amount: '$totalAmount',
          count: '$count',
        },
      },
      { $sort: { amount: -1 } },
    ]);

    // 5. Payment Method Breakdown
    const paymentMethodStats = await Transaction.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$paymentMethod',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        timeframe,
        dateRange: { start, end },
        summary: {
          totalIncome,
          totalExpense,
          netSavings,
          savingsRate,
          txCount,
          maxExpense,
          avgMonthlyExpense,
          avgMonthlyIncome,
          monthCount: monthDiff,
        },
        monthlyTrends,
        categorySpending: formattedCategorySpending,
        topCategories: formattedCategorySpending.slice(0, 5),
        categoryIncome,
        paymentMethodStats,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getReportAnalytics,
};
