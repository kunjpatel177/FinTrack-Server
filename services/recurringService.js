const Recurring = require('../models/Recurring');
const Transaction = require('../models/Transaction');
const { logActivity } = require('./activityService');

const calculateNextDate = (fromDate, frequency) => {
  const date = new Date(fromDate);
  if (frequency === 'weekly') {
    date.setDate(date.getDate() + 7);
  } else if (frequency === 'monthly') {
    date.setMonth(date.getMonth() + 1);
  } else if (frequency === 'yearly') {
    date.setFullYear(date.getFullYear() + 1);
  }
  return date;
};

const processDueRecurringTransactions = async (userId = null) => {
  const now = new Date();
  const query = {
    isActive: true,
    nextDueDate: { $lte: now },
  };

  if (userId) {
    query.user = userId;
  }

  const dueItems = await Recurring.find(query);
  let processedCount = 0;

  for (const item of dueItems) {
    let currentDue = new Date(item.nextDueDate);

    // Safeguard to prevent infinite loops if dates are way in the past (max 24 iterations)
    let iterations = 0;
    while (currentDue <= now && iterations < 24) {
      iterations++;

      // Check if end date reached
      if (item.endDate && currentDue > new Date(item.endDate)) {
        item.isActive = false;
        break;
      }

      // Check for duplicate transaction on that due date
      const startOfDay = new Date(currentDue);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(currentDue);
      endOfDay.setHours(23, 59, 59, 999);

      const existingTx = await Transaction.findOne({
        user: item.user,
        recurringRef: item._id,
        date: { $gte: startOfDay, $lte: endOfDay },
      });

      if (!existingTx) {
        await Transaction.create({
          user: item.user,
          type: item.type,
          amount: item.amount,
          category: item.category,
          description: `${item.description} (Recurring)`,
          paymentMethod: item.paymentMethod,
          date: currentDue,
          recurringRef: item._id,
          household: item.household,
          isShared: !!item.household,
        });

        processedCount++;

        await logActivity(
          item.user,
          'RECURRING_PROCESSED',
          `Processed recurring ${item.type}: "${item.description}" (${item.amount})`,
          { recurringId: item._id }
        );
      }

      // Advance to next due date
      currentDue = calculateNextDate(currentDue, item.frequency);
    }

    item.lastProcessedDate = now;
    item.nextDueDate = currentDue;

    if (item.endDate && currentDue > new Date(item.endDate)) {
      item.isActive = false;
    }

    await item.save();
  }

  return { processedCount, dueItemsFound: dueItems.length };
};

module.exports = {
  calculateNextDate,
  processDueRecurringTransactions,
};
