const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getDashboardCharts,
} = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/summary', getDashboardSummary);
router.get('/charts', getDashboardCharts);

module.exports = router;
