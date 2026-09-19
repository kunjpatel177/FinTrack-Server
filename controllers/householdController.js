const mongoose = require('mongoose');
const Household = require('../models/Household');
const Invitation = require('../models/Invitation');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { logActivity } = require('../services/activityService');

// @desc    Get current user's household
// @route   GET /api/v1/household
// @access  Private
const getHousehold = async (req, res, next) => {
  try {
    const household = await Household.findOne({
      'members.user': req.user.id,
    })
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar');

    if (!household) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'User is not currently in any household',
      });
    }

    // Pending invitations for this household
    const pendingInvites = await Invitation.find({
      household: household._id,
      status: 'pending',
    }).populate('invitedBy', 'name email');

    // Current month shared stats
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const sharedExpenses = await Transaction.aggregate([
      {
        $match: {
          household: household._id,
          type: 'expense',
          date: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: '$user',
          totalSpent: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      { $unwind: '$userDetails' },
      {
        $project: {
          userId: '$_id',
          userName: '$userDetails.name',
          userEmail: '$userDetails.email',
          totalSpent: '$totalSpent',
          count: '$count',
        },
      },
    ]);

    const totalSharedMonthExpense = sharedExpenses.reduce((acc, curr) => acc + curr.totalSpent, 0);

    res.status(200).json({
      success: true,
      data: {
        household,
        pendingInvites,
        stats: {
          totalSharedMonthExpense,
          memberSpending: sharedExpenses,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new household
// @route   POST /api/v1/household
// @access  Private
const createHousehold = async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Household name is required' });
    }

    // Check if user is already in a household
    const existing = await Household.findOne({ 'members.user': req.user.id });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of a household. Leave your current household before creating a new one.',
      });
    }

    const household = await Household.create({
      name: name.trim(),
      owner: req.user.id,
      members: [
        {
          user: req.user.id,
          role: 'owner',
          joinedAt: new Date(),
        },
      ],
    });

    await User.findByIdAndUpdate(req.user.id, { activeHousehold: household._id });

    await logActivity(
      req.user.id,
      'HOUSEHOLD_CREATE',
      `Created household "${household.name}"`
    );

    res.status(201).json({
      success: true,
      message: 'Household created successfully',
      data: household,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Invite member to household
// @route   POST /api/v1/household/invite
// @access  Private
const inviteMember = async (req, res, next) => {
  try {
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Invitee email is required' });
    }

    const household = await Household.findOne({ 'members.user': req.user.id });
    if (!household) {
      return res.status(404).json({ success: false, message: 'You do not belong to any household' });
    }

    // Check authorization: must be owner or admin
    const currentUserMember = household.members.find(
      (m) => m.user.toString() === req.user.id
    );
    if (!currentUserMember || !['owner', 'admin'].includes(currentUserMember.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only household owners and admins can invite members',
      });
    }

    const inviteeEmail = email.toLowerCase().trim();

    // Check if already in this household
    const existingUser = await User.findOne({ email: inviteeEmail });
    if (existingUser) {
      const isAlreadyMember = household.members.some(
        (m) => m.user.toString() === existingUser._id.toString()
      );
      if (isAlreadyMember) {
        return res.status(400).json({
          success: false,
          message: 'User is already a member of this household',
        });
      }
    }

    // Check pending invite
    const existingInvite = await Invitation.findOne({
      household: household._id,
      email: inviteeEmail,
      status: 'pending',
    });

    if (existingInvite) {
      return res.status(400).json({
        success: false,
        message: 'An active invitation has already been sent to this email',
        invitationToken: existingInvite.token,
      });
    }

    const token = Invitation.generateToken();
    const invitation = await Invitation.create({
      household: household._id,
      invitedBy: req.user.id,
      email: inviteeEmail,
      role: role || 'member',
      token,
    });

    await logActivity(
      req.user.id,
      'HOUSEHOLD_INVITE',
      `Sent household invite to ${inviteeEmail} for "${household.name}"`
    );

    res.status(201).json({
      success: true,
      message: `Invitation generated for ${inviteeEmail}`,
      data: {
        invitationId: invitation._id,
        email: invitation.email,
        token: invitation.token,
        inviteLink: `/accept-invite?token=${token}`,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Accept household invitation
// @route   POST /api/v1/household/accept-invite
// @access  Private
const acceptInvite = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Invitation token is required' });
    }

    const invitation = await Invitation.findOne({
      token,
      status: 'pending',
      expiresAt: { $gt: new Date() },
    });

    if (!invitation) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired invitation token',
      });
    }

    // Check if user already in household
    const existingHousehold = await Household.findOne({ 'members.user': req.user.id });
    if (existingHousehold) {
      return res.status(400).json({
        success: false,
        message: 'You are already in a household. Please leave your current household before joining another.',
      });
    }

    const household = await Household.findById(invitation.household);
    if (!household) {
      return res.status(404).json({ success: false, message: 'Household no longer exists' });
    }

    // Add member
    household.members.push({
      user: req.user.id,
      role: invitation.role,
      joinedAt: new Date(),
    });
    await household.save();

    // Mark invitation accepted
    invitation.status = 'accepted';
    await invitation.save();

    await User.findByIdAndUpdate(req.user.id, { activeHousehold: household._id });

    await logActivity(
      req.user.id,
      'HOUSEHOLD_JOIN',
      `Joined household "${household.name}"`
    );

    res.status(200).json({
      success: true,
      message: `You have successfully joined "${household.name}"`,
      data: household,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove member from household
// @route   DELETE /api/v1/household/members/:userId
// @access  Private
const removeMember = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId;

    const household = await Household.findOne({ 'members.user': req.user.id });
    if (!household) {
      return res.status(404).json({ success: false, message: 'Household not found' });
    }

    const currentMember = household.members.find(
      (m) => m.user.toString() === req.user.id
    );

    if (!currentMember || !['owner', 'admin'].includes(currentMember.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only owners and admins can remove members',
      });
    }

    // Cannot remove owner
    if (household.owner.toString() === targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'The household owner cannot be removed',
      });
    }

    household.members = household.members.filter(
      (m) => m.user.toString() !== targetUserId
    );
    await household.save();

    await User.findByIdAndUpdate(targetUserId, { activeHousehold: null });

    await logActivity(
      req.user.id,
      'HOUSEHOLD_MEMBER_REMOVE',
      `Removed member from household`
    );

    res.status(200).json({
      success: true,
      message: 'Member removed from household',
      data: household,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Leave household
// @route   POST /api/v1/household/leave
// @access  Private
const leaveHousehold = async (req, res, next) => {
  try {
    const household = await Household.findOne({ 'members.user': req.user.id });
    if (!household) {
      return res.status(404).json({ success: false, message: 'You are not in a household' });
    }

    if (household.owner.toString() === req.user.id) {
      if (household.members.length > 1) {
        return res.status(400).json({
          success: false,
          message: 'As the owner, you must transfer ownership to another member before leaving.',
        });
      } else {
        // Only owner left: delete household
        await Household.findByIdAndDelete(household._id);
        await User.findByIdAndUpdate(req.user.id, { activeHousehold: null });

        await logActivity(req.user.id, 'HOUSEHOLD_DELETE', `Deleted household "${household.name}"`);

        return res.status(200).json({
          success: true,
          message: 'Household deleted as you were the sole member',
        });
      }
    }

    household.members = household.members.filter(
      (m) => m.user.toString() !== req.user.id
    );
    await household.save();

    await User.findByIdAndUpdate(req.user.id, { activeHousehold: null });

    await logActivity(req.user.id, 'HOUSEHOLD_LEAVE', `Left household "${household.name}"`);

    res.status(200).json({
      success: true,
      message: 'You have left the household',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get shared transactions for household
// @route   GET /api/v1/household/transactions
// @access  Private
const getSharedTransactions = async (req, res, next) => {
  try {
    const household = await Household.findOne({ 'members.user': req.user.id });
    if (!household) {
      return res.status(404).json({ success: false, message: 'You are not part of any household' });
    }

    const transactions = await Transaction.find({ household: household._id })
      .populate('user', 'name email avatar')
      .populate('category', 'name type icon color')
      .sort({ date: -1 })
      .limit(100);

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getHousehold,
  createHousehold,
  inviteMember,
  acceptInvite,
  removeMember,
  leaveHousehold,
  getSharedTransactions,
};
