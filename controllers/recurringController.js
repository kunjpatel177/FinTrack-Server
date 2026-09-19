const Recurring = require('../models/Recurring');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const { calculateNextDate, processDueRecurringTransactions } = require('../services/recurringService');
const { logActivity } = require('../services/activityService');

// @desc    Get all recurring transactions for user
// @route   GET /api/v1/recurring
// @access  Private
const getRecurringTransactions = async (req, res, next) => {
  try {
    const recurring = await Recurring.find({ user: req.user.id })
      .populate('category', 'name type icon color')
      .sort({ nextDueDate: 1 });

    res.status(200).json({
      success: true,
      count: recurring.length,
      data: recurring,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create recurring transaction
// @route   POST /api/v1/recurring
// @access  Private
const createRecurringTransaction = async (req, res, next) => {
  try {
    const {
      type,
      amount,
      category,
      description,
      paymentMethod,
      frequency,
      startDate,
      endDate,
    } = req.body;

    if (!type || !amount || !category || !description || !frequency) {
      return res.status(400).json({
        success: false,
        message: 'Type, amount, category, description, and frequency are required',
      });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be positive' });
    }

    const cat = await Category.findById(category);
    if (!cat) {
      return res.status(400).json({ success: false, message: 'Invalid category' });
    }

    const start = startDate ? new Date(startDate) : new Date();
    let nextDue = new Date(start);

    // If start date is in the past, determine proper next due date
    const now = new Date();
    if (nextDue <= now) {
      nextDue = calculateNextDate(nextDue, frequency);
    }

    const recurring = await Recurring.create({
      user: req.user.id,
      type,
      amount: numAmount,
      category,
      description: description.trim(),
      paymentMethod: paymentMethod || 'Bank Transfer',
      frequency,
      startDate: start,
      nextDueDate: nextDue,
      endDate: endDate ? new Date(endDate) : null,
      isActive: true,
    });

    await recurring.populate('category', 'name type icon color');

    await logActivity(
      req.user.id,
      'RECURRING_CREATE',
      `Created recurring ${frequency} ${type}: "${description}" (${numAmount})`
    );

    res.status(201).json({
      success: true,
      message: 'Recurring transaction scheduled successfully',
      data: recurring,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update recurring transaction
// @route   PUT /api/v1/recurring/:id
// @access  Private
const updateRecurringTransaction = async (req, res, next) => {
  try {
    const recurring = await Recurring.findById(req.params.id);

    if (!recurring) {
      return res.status(404).json({ success: false, message: 'Recurring transaction not found' });
    }

    if (recurring.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const {
      amount,
      category,
      description,
      paymentMethod,
      frequency,
      isActive,
      endDate,
    } = req.body;

    if (amount !== undefined) {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Amount must be positive' });
      }
      recurring.amount = numAmount;
    }

    if (category) {
      const cat = await Category.findById(category);
      if (!cat) return res.status(400).json({ success: false, message: 'Invalid category' });
      recurring.category = category;
    }

    if (description) recurring.description = description.trim();
    if (paymentMethod) recurring.paymentMethod = paymentMethod;
    if (frequency) recurring.frequency = frequency;
    if (isActive !== undefined) recurring.isActive = !!isActive;
    if (endDate !== undefined) recurring.endDate = endDate ? new Date(endDate) : null;

    await recurring.save();
    await recurring.populate('category', 'name type icon color');

    await logActivity(
      req.user.id,
      'RECURRING_UPDATE',
      `Updated recurring rule: "${recurring.description}"`
    );

    res.status(200).json({
      success: true,
      message: 'Recurring rule updated successfully',
      data: recurring,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete recurring transaction
// @route   DELETE /api/v1/recurring/:id
// @access  Private
const deleteRecurringTransaction = async (req, res, next) => {
  try {
    const recurring = await Recurring.findById(req.params.id);

    if (!recurring) {
      return res.status(404).json({ success: false, message: 'Recurring transaction not found' });
    }

    if (recurring.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await Recurring.findByIdAndDelete(req.params.id);

    await logActivity(
      req.user.id,
      'RECURRING_DELETE',
      `Deleted recurring rule: "${recurring.description}"`
    );

    res.status(200).json({
      success: true,
      message: 'Recurring rule removed successfully',
      data: {},
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Trigger manual processing of due recurring transactions
// @route   POST /api/v1/recurring/process
// @access  Private
const triggerProcess = async (req, res, next) => {
  try {
    const result = await processDueRecurringTransactions(req.user.id);

    res.status(200).json({
      success: true,
      message: `Processed ${result.processedCount} due recurring transactions.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getRecurringTransactions,
  createRecurringTransaction,
  updateRecurringTransaction,
  deleteRecurringTransaction,
  triggerProcess,
};
