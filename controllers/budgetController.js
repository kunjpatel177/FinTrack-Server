const mongoose = require('mongoose');
const Budget = require('../models/Budget');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const { logActivity } = require('../services/activityService');

// @desc    Get all budgets for a given month and year with computed spending
// @route   GET /api/v1/budgets
// @access  Private
const getBudgets = async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const currentDate = new Date();
    const month = parseInt(req.query.month, 10) || currentDate.getMonth() + 1;
    const year = parseInt(req.query.year, 10) || currentDate.getFullYear();

    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    // 1. Fetch budgets
    const budgets = await Budget.find({ user: userId, month, year }).populate(
      'category',
      'name type icon color'
    );

    // 2. Fetch actual expenses per category for this month
    const categoryExpenses = await Transaction.aggregate([
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
          totalSpent: {
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
    ]);

    // Map spent by category ID
    const spentMap = {};
    let totalOverallSpent = 0;
    categoryExpenses.forEach((item) => {
      const net = Math.max(0, item.totalSpent);
      spentMap[item._id.toString()] = net;
      totalOverallSpent += net;
    });

    let totalBudgetedAmount = 0;
    let totalSpentOnBudgets = 0;

    const budgetsWithMetrics = budgets.map((b) => {
      let spent = 0;
      if (b.category) {
        spent = spentMap[b.category._id.toString()] || 0;
      } else {
        // Overall budget
        spent = totalOverallSpent;
      }

      totalBudgetedAmount += b.amount;
      totalSpentOnBudgets += spent;

      const remaining = Math.max(0, b.amount - spent);
      const percentage = b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0;
      let status = 'normal';
      if (spent > b.amount) {
        status = 'exceeded';
      } else if (percentage >= 80) {
        status = 'warning';
      }

      return {
        _id: b._id,
        category: b.category,
        isOverall: !b.category,
        month: b.month,
        year: b.year,
        amount: b.amount,
        spent,
        remaining,
        percentage,
        status,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        filter: { month, year },
        budgets: budgetsWithMetrics,
        summary: {
          totalBudget: totalBudgetedAmount,
          totalSpent: totalSpentOnBudgets,
          remaining: Math.max(0, totalBudgetedAmount - totalSpentOnBudgets),
          overallPercentage:
            totalBudgetedAmount > 0
              ? Math.round((totalSpentOnBudgets / totalBudgetedAmount) * 100)
              : 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new budget
// @route   POST /api/v1/budgets
// @access  Private
const createBudget = async (req, res, next) => {
  try {
    const { category, month, year, amount } = req.body;

    if (!month || !year || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Month, year, and budget amount are required',
      });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Budget amount must be greater than zero',
      });
    }

    const catId = category && category !== '' ? category : null;
    if (catId) {
      const catExists = await Category.findById(catId);
      if (!catExists) {
        return res.status(400).json({ success: false, message: 'Invalid category' });
      }
    }

    // Check duplicate
    const existing = await Budget.findOne({
      user: req.user.id,
      category: catId,
      month: parseInt(month, 10),
      year: parseInt(year, 10),
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A budget already exists for this category/month/year. You can update it instead.',
      });
    }

    const budget = await Budget.create({
      user: req.user.id,
      category: catId,
      month: parseInt(month, 10),
      year: parseInt(year, 10),
      amount: numAmount,
    });

    await budget.populate('category', 'name type icon color');

    await logActivity(
      req.user.id,
      'BUDGET_CREATE',
      `Set budget of ${numAmount} for ${catId ? budget.category.name : 'Overall'} (${month}/${year})`
    );

    res.status(201).json({
      success: true,
      message: 'Budget created successfully',
      data: budget,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update budget
// @route   PUT /api/v1/budgets/:id
// @access  Private
const updateBudget = async (req, res, next) => {
  try {
    const budget = await Budget.findById(req.params.id);

    if (!budget) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }

    if (budget.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const { amount } = req.body;
    if (amount !== undefined) {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Amount must be positive' });
      }
      budget.amount = numAmount;
    }

    await budget.save();
    await budget.populate('category', 'name type icon color');

    await logActivity(
      req.user.id,
      'BUDGET_UPDATE',
      `Updated budget to ${budget.amount}`
    );

    res.status(200).json({
      success: true,
      message: 'Budget updated successfully',
      data: budget,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete budget
// @route   DELETE /api/v1/budgets/:id
// @access  Private
const deleteBudget = async (req, res, next) => {
  try {
    const budget = await Budget.findById(req.params.id);

    if (!budget) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }

    if (budget.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await Budget.findByIdAndDelete(req.params.id);

    await logActivity(
      req.user.id,
      'BUDGET_DELETE',
      `Deleted budget for month ${budget.month}/${budget.year}`
    );

    res.status(200).json({
      success: true,
      message: 'Budget removed successfully',
      data: {},
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get budget performance history for past 6 months
// @route   GET /api/v1/budgets/history
// @access  Private
const getBudgetHistory = async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];

    const history = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1 - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;

      const startOfMonth = new Date(y, m - 1, 1);
      const endOfMonth = new Date(y, m, 0, 23, 59, 59, 999);

      // Budgets total
      const budgets = await Budget.find({ user: userId, month: m, year: y });
      let totalBudget = 0;
      budgets.forEach((b) => (totalBudget += b.amount));

      // Actual expenses
      const expenseAgg = await Transaction.aggregate([
        {
          $match: {
            user: userId,
            type: 'expense',
            date: { $gte: startOfMonth, $lte: endOfMonth },
          },
        },
        {
          $group: {
            _id: null,
            totalSpent: {
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
      ]);

      const totalSpent = expenseAgg.length > 0 ? Math.max(0, expenseAgg[0].totalSpent) : 0;

      history.push({
        month: `${monthNames[m - 1]} ${y.toString().slice(-2)}`,
        year: y,
        monthNum: m,
        budget: totalBudget,
        spent: totalSpent,
        variance: totalBudget - totalSpent,
      });
    }

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgetHistory,
};
