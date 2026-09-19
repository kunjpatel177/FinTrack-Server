const mongoose = require('mongoose');
const { Parser } = require('json2csv');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const Budget = require('../models/Budget');
const Household = require('../models/Household');
const { logActivity } = require('../services/activityService');

// Helper to build query filter based on request query parameters
const buildFilter = async (userId, query) => {
  const {
    type,
    category,
    paymentMethod,
    startDate,
    endDate,
    search,
    householdId,
  } = query;

  const filter = {};

  if (householdId) {
    // Verify user is member of this household
    const household = await Household.findOne({
      _id: householdId,
      'members.user': userId,
    });
    if (household) {
      filter.household = householdId;
    } else {
      filter.user = userId; // fallback
    }
  } else {
    filter.user = userId;
  }

  if (type && ['income', 'expense'].includes(type)) {
    filter.type = type;
  }

  if (category) {
    if (mongoose.Types.ObjectId.isValid(category)) {
      filter.category = category;
    }
  }

  if (paymentMethod) {
    filter.paymentMethod = paymentMethod;
  }

  if (startDate || endDate) {
    filter.date = {};
    if (startDate) {
      filter.date.$gte = new Date(startDate);
    }
    if (endDate) {
      // Set to end of the day
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.date.$lte = end;
    }
  }

  if (search && search.trim() !== '') {
    filter.description = { $regex: search.trim(), $options: 'i' };
  }

  return filter;
};

// @desc    Get all transactions with search, filter, sort, and pagination
// @route   GET /api/v1/transactions
// @access  Private
const getTransactions = async (req, res, next) => {
  try {
    const filter = await buildFilter(req.user.id, req.query);

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const sortBy = req.query.sortBy || 'date';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortBy]: sortOrder };

    const totalCount = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .populate('category', 'name type icon color')
      .populate('user', 'name email avatar')
      .sort(sort)
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      data: transactions,
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

// @desc    Get single transaction
// @route   GET /api/v1/transactions/:id
// @access  Private
const getTransaction = async (req, res, next) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('category', 'name type icon color')
      .populate('user', 'name email avatar');

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Ownership check (or shared household check)
    if (transaction.user._id.toString() !== req.user.id) {
      if (!transaction.household) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
      const isMember = await Household.findOne({
        _id: transaction.household,
        'members.user': req.user.id,
      });
      if (!isMember) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
    }

    res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new transaction
// @route   POST /api/v1/transactions
// @access  Private
const createTransaction = async (req, res, next) => {
  try {
    const {
      type,
      amount,
      category,
      description,
      paymentMethod,
      date,
      notes,
      householdId,
      isShared,
    } = req.body;

    if (!type || !amount || !category || !description || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields (type, amount, category, description, paymentMethod)',
      });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be a positive number',
      });
    }

    // Validate category exists
    const cat = await Category.findById(category);
    if (!cat) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category selected',
      });
    }

    const txDate = date ? new Date(date) : new Date();
    if (isNaN(txDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction date',
      });
    }

    const transactionData = {
      user: req.user.id,
      type,
      amount: numAmount,
      category,
      description: description.trim(),
      paymentMethod,
      date: txDate,
      notes: notes ? notes.trim() : '',
      isShared: !!isShared,
    };

    if (householdId) {
      const household = await Household.findOne({
        _id: householdId,
        'members.user': req.user.id,
      });
      if (household) {
        transactionData.household = householdId;
        transactionData.isShared = true;
      }
    }

    const transaction = await Transaction.create(transactionData);
    await transaction.populate('category', 'name type icon color');

    await logActivity(
      req.user.id,
      'TRANSACTION_CREATE',
      `Added ${type} of ${numAmount}: "${description}"`,
      { transactionId: transaction._id, amount: numAmount, type }
    );

    // Check budget alert if expense
    let budgetAlert = null;
    if (type === 'expense') {
      const month = txDate.getMonth() + 1;
      const year = txDate.getFullYear();

      const budget = await Budget.findOne({
        user: req.user.id,
        category: cat._id,
        month,
        year,
      });

      if (budget) {
        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

        const spentResult = await Transaction.aggregate([
          {
            $match: {
              user: new mongoose.Types.ObjectId(req.user.id),
              category: cat._id,
              type: 'expense',
              date: { $gte: startOfMonth, $lte: endOfMonth },
            },
          },
          { $group: { _id: null, totalSpent: { $sum: '$amount' } } },
        ]);

        const totalSpent = spentResult.length > 0 ? spentResult[0].totalSpent : 0;
        const percentage = (totalSpent / budget.amount) * 100;

        if (percentage >= 100) {
          budgetAlert = {
            exceeded: true,
            category: cat.name,
            budgetAmount: budget.amount,
            totalSpent,
            percentage: Math.round(percentage),
            message: `Warning: You have exceeded your budget for ${cat.name}! Spent: ${totalSpent}, Budget: ${budget.amount}`,
          };
        } else if (percentage >= 80) {
          budgetAlert = {
            warning: true,
            category: cat.name,
            budgetAmount: budget.amount,
            totalSpent,
            percentage: Math.round(percentage),
            message: `Alert: You have used ${Math.round(percentage)}% of your budget for ${cat.name}.`,
          };
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'Transaction recorded successfully',
      data: transaction,
      budgetAlert,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update transaction
// @route   PUT /api/v1/transactions/:id
// @access  Private
const updateTransaction = async (req, res, next) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    if (transaction.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this transaction' });
    }

    const {
      type,
      amount,
      category,
      description,
      paymentMethod,
      date,
      notes,
      isShared,
    } = req.body;

    if (amount !== undefined) {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
      }
      transaction.amount = numAmount;
    }

    if (type) transaction.type = type;
    if (category) {
      const cat = await Category.findById(category);
      if (!cat) {
        return res.status(400).json({ success: false, message: 'Invalid category' });
      }
      transaction.category = category;
    }
    if (description) transaction.description = description.trim();
    if (paymentMethod) transaction.paymentMethod = paymentMethod;
    if (date) transaction.date = new Date(date);
    if (notes !== undefined) transaction.notes = notes ? notes.trim() : '';
    if (isShared !== undefined) transaction.isShared = !!isShared;

    await transaction.save();
    await transaction.populate('category', 'name type icon color');

    await logActivity(
      req.user.id,
      'TRANSACTION_UPDATE',
      `Updated transaction: "${transaction.description}"`,
      { transactionId: transaction._id }
    );

    res.status(200).json({
      success: true,
      message: 'Transaction updated successfully',
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete transaction
// @route   DELETE /api/v1/transactions/:id
// @access  Private
const deleteTransaction = async (req, res, next) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    if (transaction.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this transaction' });
    }

    await Transaction.findByIdAndDelete(req.params.id);

    await logActivity(
      req.user.id,
      'TRANSACTION_DELETE',
      `Deleted transaction: "${transaction.description}" of amount ${transaction.amount}`,
      { transactionId: transaction._id }
    );

    res.status(200).json({
      success: true,
      message: 'Transaction deleted successfully',
      data: {},
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export filtered transactions as CSV
// @route   GET /api/v1/transactions/export/csv
// @access  Private
const exportTransactionsCsv = async (req, res, next) => {
  try {
    const filter = await buildFilter(req.user.id, req.query);

    const transactions = await Transaction.find(filter)
      .populate('category', 'name type')
      .populate('user', 'name email')
      .sort({ date: -1 })
      .limit(5000);

    const fields = [
      { label: 'Date', value: (row) => new Date(row.date).toISOString().split('T')[0] },
      { label: 'Type', value: 'type' },
      { label: 'Description', value: 'description' },
      { label: 'Category', value: (row) => (row.category ? row.category.name : 'Uncategorized') },
      { label: 'Amount', value: 'amount' },
      { label: 'Payment Method', value: 'paymentMethod' },
      { label: 'Notes', value: (row) => row.notes || '' },
      { label: 'Shared', value: (row) => (row.isShared ? 'Yes' : 'No') },
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(transactions);

    res.header('Content-Type', 'text/csv');
    res.attachment(`fintrack_transactions_${new Date().toISOString().slice(0, 10)}.csv`);
    return res.send(csv);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTransactions,
  getTransaction,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  exportTransactionsCsv,
};
