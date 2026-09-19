const express = require('express');
const router = express.Router();
const {
  getRecurringTransactions,
  createRecurringTransaction,
  updateRecurringTransaction,
  deleteRecurringTransaction,
  triggerProcess,
} = require('../controllers/recurringController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.post('/process', triggerProcess);

router.route('/')
  .get(getRecurringTransactions)
  .post(createRecurringTransaction);

router.route('/:id')
  .put(updateRecurringTransaction)
  .delete(deleteRecurringTransaction);

module.exports = router;
