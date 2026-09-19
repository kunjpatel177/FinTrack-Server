const express = require('express');
const router = express.Router();
const {
  getHousehold,
  createHousehold,
  inviteMember,
  acceptInvite,
  removeMember,
  leaveHousehold,
  getSharedTransactions,
} = require('../controllers/householdController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getHousehold)
  .post(createHousehold);

router.post('/invite', inviteMember);
router.post('/accept-invite', acceptInvite);
router.post('/leave', leaveHousehold);
router.delete('/members/:userId', removeMember);
router.get('/transactions', getSharedTransactions);

module.exports = router;
