const Goal = require('../models/Goal');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const { logActivity } = require('../services/activityService');

// @desc    Get all financial goals for user
// @route   GET /api/v1/goals
// @access  Private
const getGoals = async (req, res, next) => {
  try {
    const goals = await Goal.find({ user: req.user.id }).sort({ targetDate: 1 });

    const goalsWithStats = goals.map((g) => {
      const remaining = Math.max(0, g.targetAmount - g.currentSavedAmount);
      const percentage = Math.min(
        Math.round((g.currentSavedAmount / g.targetAmount) * 100),
        100
      );

      const today = new Date();
      const target = new Date(g.targetDate);
      const diffTime = target - today;
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return {
        _id: g._id,
        name: g.name,
        targetAmount: g.targetAmount,
        currentSavedAmount: g.currentSavedAmount,
        remaining,
        percentage,
        daysRemaining: daysRemaining < 0 ? 0 : daysRemaining,
        isExpired: daysRemaining < 0 && g.status === 'in_progress',
        targetDate: g.targetDate,
        category: g.category,
        description: g.description,
        status: g.status,
        contributions: g.contributions,
        createdAt: g.createdAt,
      };
    });

    res.status(200).json({
      success: true,
      count: goalsWithStats.length,
      data: goalsWithStats,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create savings goal
// @route   POST /api/v1/goals
// @access  Private
const createGoal = async (req, res, next) => {
  try {
    const {
      name,
      targetAmount,
      currentSavedAmount,
      targetDate,
      category,
      description,
      createTransaction = true,
      paymentMethod = 'Bank Transfer',
      date,
    } = req.body;

    if (!name || !targetAmount || !targetDate) {
      return res.status(400).json({
        success: false,
        message: 'Name, target amount, and target date are required',
      });
    }

    const numTarget = parseFloat(targetAmount);
    if (isNaN(numTarget) || numTarget <= 0) {
      return res.status(400).json({ success: false, message: 'Target amount must be positive' });
    }

    const numSaved = currentSavedAmount ? parseFloat(currentSavedAmount) : 0;
    if (numSaved < 0) {
      return res.status(400).json({ success: false, message: 'Already saved amount cannot be negative' });
    }

    let linkedTxId = null;
    if (numSaved > 0 && createTransaction) {
      let cat = await Category.findOne({
        $or: [
          { name: 'Savings & Investments', type: 'expense' },
          { name: 'Investments', type: 'expense' },
          { name: 'Other Expense', type: 'expense' },
        ],
      });
      if (!cat) {
        cat = await Category.findOne({ type: 'expense' });
      }

      const txDate = date ? new Date(date) : new Date();
      const tx = await Transaction.create({
        user: req.user.id,
        type: 'expense',
        amount: numSaved,
        category: cat ? cat._id : null,
        description: `Goal Initial Savings: ${name.trim()}`,
        paymentMethod: paymentMethod || 'Bank Transfer',
        date: txDate,
        notes: `Initial saved funds allocated to goal "${name.trim()}"`,
      });
      linkedTxId = tx._id;
    }

    const goal = await Goal.create({
      user: req.user.id,
      name: name.trim(),
      targetAmount: numTarget,
      currentSavedAmount: numSaved,
      targetDate: new Date(targetDate),
      category: category || 'Savings',
      description: description ? description.trim() : '',
      status: numSaved >= numTarget ? 'completed' : 'in_progress',
      contributions:
        numSaved > 0
          ? [
              {
                amount: numSaved,
                date: date ? new Date(date) : new Date(),
                note: 'Initial already saved funds',
                type: 'deposit',
                transactionRef: linkedTxId,
              },
            ]
          : [],
    });

    await logActivity(
      req.user.id,
      'GOAL_CREATE',
      numSaved > 0
        ? `Created financial goal: "${goal.name}" with initial savings of ${numSaved} (Target: ${numTarget})`
        : `Created financial goal: "${goal.name}" (Target: ${numTarget})`,
      { goalId: goal._id, transactionId: linkedTxId, initialSavings: numSaved }
    );

    res.status(201).json({
      success: true,
      message:
        numSaved > 0 && linkedTxId
          ? `Goal created! ${numSaved} initial savings reflected in net savings & net balance.`
          : 'Financial goal created successfully',
      data: goal,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update savings goal
// @route   PUT /api/v1/goals/:id
// @access  Private
const updateGoal = async (req, res, next) => {
  try {
    const goal = await Goal.findById(req.params.id);

    if (!goal) {
      return res.status(404).json({ success: false, message: 'Goal not found' });
    }

    if (goal.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const {
      name,
      targetAmount,
      targetDate,
      category,
      description,
      status,
      currentSavedAmount,
      createTransaction = true,
      paymentMethod = 'Bank Transfer',
      date,
    } = req.body;

    if (name) goal.name = name.trim();
    if (targetAmount !== undefined) {
      const numTarget = parseFloat(targetAmount);
      if (isNaN(numTarget) || numTarget <= 0) {
        return res.status(400).json({ success: false, message: 'Target amount must be positive' });
      }
      goal.targetAmount = numTarget;
    }
    if (targetDate) goal.targetDate = new Date(targetDate);
    if (category) goal.category = category;
    if (description !== undefined) goal.description = description.trim();
    if (status) goal.status = status;

    // Handle change in already saved amount if passed
    if (currentSavedAmount !== undefined) {
      const newSaved = parseFloat(currentSavedAmount);
      if (isNaN(newSaved) || newSaved < 0) {
        return res.status(400).json({ success: false, message: 'Saved amount must be a valid non-negative number' });
      }

      const delta = Math.round((newSaved - goal.currentSavedAmount) * 100) / 100;
      if (delta !== 0 && createTransaction) {
        let linkedTxId = null;
        const txDate = date ? new Date(date) : new Date();

        if (delta > 0) {
          // Increase saved amount -> expense transaction
          let cat = await Category.findOne({
            $or: [
              { name: 'Savings & Investments', type: 'expense' },
              { name: 'Investments', type: 'expense' },
              { name: 'Other Expense', type: 'expense' },
            ],
          });
          if (!cat) cat = await Category.findOne({ type: 'expense' });

          const tx = await Transaction.create({
            user: req.user.id,
            type: 'expense',
            amount: delta,
            category: cat ? cat._id : null,
            description: `Goal Savings Adjustment: ${goal.name}`,
            paymentMethod: paymentMethod || 'Bank Transfer',
            date: txDate,
            notes: `Adjusted already saved amount for goal "${goal.name}" (+${delta})`,
          });
          linkedTxId = tx._id;

          goal.contributions.push({
            amount: delta,
            date: txDate,
            note: 'Savings adjustment (increased)',
            type: 'deposit',
            transactionRef: linkedTxId,
          });
        } else if (delta < 0) {
          // Decrease saved amount -> expense refund transaction (offsets expenses)
          const refundAmount = Math.abs(delta);
          let cat = await Category.findOne({
            $or: [
              { name: 'Savings & Investments', type: 'expense' },
              { name: 'Investments', type: 'expense' },
              { name: 'Other Expense', type: 'expense' },
            ],
          });
          if (!cat) cat = await Category.findOne({ type: 'expense' });

          const tx = await Transaction.create({
            user: req.user.id,
            type: 'expense',
            isRefund: true,
            amount: refundAmount,
            category: cat ? cat._id : null,
            description: `Goal Savings Adjustment (Refund): ${goal.name}`,
            paymentMethod: paymentMethod || 'Bank Transfer',
            date: txDate,
            notes: `Adjusted already saved amount for goal "${goal.name}". Refunded ${refundAmount} to expenses & balance.`,
          });
          linkedTxId = tx._id;

          goal.contributions.push({
            amount: refundAmount,
            date: txDate,
            note: 'Savings adjustment (refund)',
            type: 'withdrawal',
            transactionRef: linkedTxId,
          });
        }
      }
      goal.currentSavedAmount = newSaved;
    }

    // Check completion
    if (goal.currentSavedAmount >= goal.targetAmount) {
      goal.status = 'completed';
    } else if (goal.status === 'completed' && goal.currentSavedAmount < goal.targetAmount) {
      goal.status = 'in_progress';
    }

    await goal.save();

    await logActivity(
      req.user.id,
      'GOAL_UPDATE',
      `Updated goal: "${goal.name}" (Saved: ${goal.currentSavedAmount}/${goal.targetAmount})`
    );

    res.status(200).json({
      success: true,
      message: 'Goal updated successfully',
      data: goal,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add contribution to goal
// @route   POST /api/v1/goals/:id/contribute
// @access  Private
const addContribution = async (req, res, next) => {
  try {
    const goal = await Goal.findById(req.params.id);

    if (!goal) {
      return res.status(404).json({ success: false, message: 'Goal not found' });
    }

    if (goal.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const {
      amount,
      note,
      createTransaction = true,
      paymentMethod = 'Bank Transfer',
      date,
    } = req.body;
    const numAmount = parseFloat(amount);

    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Contribution amount must be a positive number',
      });
    }

    goal.currentSavedAmount += numAmount;

    let linkedTxId = null;
    if (createTransaction) {
      // Find category for savings
      let cat = await Category.findOne({
        $or: [
          { name: 'Savings & Investments', type: 'expense' },
          { name: 'Investments', type: 'expense' },
          { name: 'Other Expense', type: 'expense' },
        ],
      });
      if (!cat) {
        cat = await Category.findOne({ type: 'expense' });
      }

      const txDate = date ? new Date(date) : new Date();
      const tx = await Transaction.create({
        user: req.user.id,
        type: 'expense',
        amount: numAmount,
        category: cat ? cat._id : null,
        description: `Goal Deposit: ${goal.name}`,
        paymentMethod: paymentMethod || 'Bank Transfer',
        date: txDate,
        notes: note ? note.trim() : `Savings contribution towards ${goal.name}`,
      });
      linkedTxId = tx._id;
    }

    goal.contributions.push({
      amount: numAmount,
      date: date ? new Date(date) : new Date(),
      note: note ? note.trim() : 'Savings contribution',
      type: 'deposit',
      transactionRef: linkedTxId,
    });

    if (goal.currentSavedAmount >= goal.targetAmount) {
      goal.status = 'completed';
    }

    await goal.save();

    await logActivity(
      req.user.id,
      'GOAL_CONTRIBUTION',
      `Added contribution of ${numAmount} to "${goal.name}" (Total: ${goal.currentSavedAmount}/${goal.targetAmount})`,
      { goalId: goal._id, transactionId: linkedTxId }
    );

    res.status(200).json({
      success: true,
      message:
        goal.status === 'completed'
          ? `Congratulations! You have achieved your goal "${goal.name}"!`
          : 'Contribution added successfully',
      data: goal,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Withdraw funds from goal back to account balance
// @route   POST /api/v1/goals/:id/withdraw
// @access  Private
const withdrawFromGoal = async (req, res, next) => {
  try {
    const goal = await Goal.findById(req.params.id);

    if (!goal) {
      return res.status(404).json({ success: false, message: 'Goal not found' });
    }

    if (goal.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const {
      amount,
      note,
      createTransaction = true,
      paymentMethod = 'Bank Transfer',
      date,
    } = req.body;
    const numAmount = parseFloat(amount);

    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal amount must be a positive number',
      });
    }

    if (numAmount > goal.currentSavedAmount) {
      return res.status(400).json({
        success: false,
        message: `Cannot withdraw more than currently saved amount (${goal.currentSavedAmount})`,
      });
    }

    goal.currentSavedAmount -= numAmount;

    let linkedTxId = null;
    if (createTransaction) {
      // Find category for savings withdrawal (contra-expense / refund to Savings & Investments)
      let cat = await Category.findOne({
        $or: [
          { name: 'Savings & Investments', type: 'expense' },
          { name: 'Investments', type: 'expense' },
          { name: 'Other Expense', type: 'expense' },
        ],
      });
      if (!cat) {
        cat = await Category.findOne({ type: 'expense' });
      }

      const txDate = date ? new Date(date) : new Date();
      const tx = await Transaction.create({
        user: req.user.id,
        type: 'expense',
        isRefund: true,
        amount: numAmount,
        category: cat ? cat._id : null,
        description: `Goal Withdrawal: ${goal.name}`,
        paymentMethod: paymentMethod || 'Bank Transfer',
        date: txDate,
        notes: note ? note.trim() : `Funds withdrawn from ${goal.name}. Credited back to expenses & balance.`,
      });
      linkedTxId = tx._id;
    }

    goal.contributions.push({
      amount: numAmount,
      date: date ? new Date(date) : new Date(),
      note: note ? note.trim() : 'Goal withdrawal',
      type: 'withdrawal',
      transactionRef: linkedTxId,
    });

    if (goal.currentSavedAmount < goal.targetAmount && goal.status === 'completed') {
      goal.status = 'in_progress';
    }

    await goal.save();

    await logActivity(
      req.user.id,
      'GOAL_WITHDRAWAL',
      `Withdrew ${numAmount} from "${goal.name}" (Remaining: ${goal.currentSavedAmount}/${goal.targetAmount})`,
      { goalId: goal._id, transactionId: linkedTxId }
    );

    res.status(200).json({
      success: true,
      message: `Withdrew ${numAmount} successfully. Funds returned to your account balance.`,
      data: goal,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete savings goal
// @route   DELETE /api/v1/goals/:id
// @access  Private
const deleteGoal = async (req, res, next) => {
  try {
    const goal = await Goal.findById(req.params.id);

    if (!goal) {
      return res.status(404).json({ success: false, message: 'Goal not found' });
    }

    if (goal.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const paymentMethod = (req.body && req.body.paymentMethod) || req.query.paymentMethod || 'Bank Transfer';
    let refundTx = null;
    let refundedAmount = 0;

    // If goal is not completed and has accumulated funds, refund them back into user's account
    if (goal.status !== 'completed' && goal.currentSavedAmount > 0) {
      refundedAmount = goal.currentSavedAmount;

      let cat = await Category.findOne({
        $or: [
          { name: 'Savings & Investments', type: 'expense' },
          { name: 'Investments', type: 'expense' },
          { name: 'Other Expense', type: 'expense' },
        ],
      });

      if (!cat) {
        cat = await Category.findOne({ type: 'expense' });
      }

      refundTx = await Transaction.create({
        user: req.user.id,
        type: 'expense',
        isRefund: true,
        amount: refundedAmount,
        category: cat ? cat._id : null,
        description: `Goal Refund: ${goal.name}`,
        paymentMethod: paymentMethod,
        date: new Date(),
        notes: `Refunded saved funds from uncompleted goal "${goal.name}" upon removal. Credited back to expenses & balance.`,
      });
    }

    await Goal.findByIdAndDelete(req.params.id);

    await logActivity(
      req.user.id,
      'GOAL_DELETE',
      refundedAmount > 0
        ? `Deleted uncompleted goal: "${goal.name}". Refunded ${refundedAmount} to account balance.`
        : `Deleted goal: "${goal.name}"`,
      {
        goalId: goal._id,
        refundedAmount,
        transactionId: refundTx ? refundTx._id : null,
      }
    );

    res.status(200).json({
      success: true,
      message:
        refundedAmount > 0
          ? `Goal "${goal.name}" deleted. Refunded ${refundedAmount} to your account balance and deducted from monthly expenses.`
          : 'Goal deleted successfully',
      data: {
        refundedAmount,
        transaction: refundTx,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getGoals,
  createGoal,
  updateGoal,
  addContribution,
  withdrawFromGoal,
  deleteGoal,
};
