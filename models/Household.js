const mongoose = require('mongoose');
const { HOUSEHOLD_ROLES } = require('../config/constants');

const MemberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: HOUSEHOLD_ROLES,
      default: 'member',
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const HouseholdSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Household name is required'],
      trim: true,
      maxlength: [60, 'Household name cannot exceed 60 characters'],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    members: [MemberSchema],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Household', HouseholdSchema);
