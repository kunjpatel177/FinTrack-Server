const DEFAULT_CATEGORIES = [
  // Expense categories
  { name: 'Food & Dining', type: 'expense', icon: 'FaUtensils', color: '#f97316' },
  { name: 'Transport', type: 'expense', icon: 'FaCar', color: '#06b6d4' },
  { name: 'Shopping', type: 'expense', icon: 'FaShoppingBag', color: '#ec4899' },
  { name: 'Bills & Utilities', type: 'expense', icon: 'FaBolt', color: '#eab308' },
  { name: 'Entertainment', type: 'expense', icon: 'FaGamepad', color: '#8b5cf6' },
  { name: 'Health & Medical', type: 'expense', icon: 'FaHeartbeat', color: '#ef4444' },
  { name: 'Education', type: 'expense', icon: 'FaGraduationCap', color: '#3b82f6' },
  { name: 'Groceries', type: 'expense', icon: 'FaCartPlus', color: '#10b981' },
  { name: 'Housing & Rent', type: 'expense', icon: 'FaHome', color: '#6366f1' },
  { name: 'Savings & Investments', type: 'expense', icon: 'FaPiggyBank', color: '#8b5cf6' },
  { name: 'Balance Adjustment', type: 'expense', icon: 'FaSlidersH', color: '#64748b' },
  { name: 'Other Expense', type: 'expense', icon: 'FaEllipsisH', color: '#64748b' },
  
  // Income categories
  { name: 'Salary', type: 'income', icon: 'FaMoneyBillWave', color: '#10b981' },
  { name: 'Freelance', type: 'income', icon: 'FaLaptopCode', color: '#3b82f6' },
  { name: 'Investments', type: 'income', icon: 'FaChartLine', color: '#8b5cf6' },
  { name: 'Savings & Investments', type: 'income', icon: 'FaPiggyBank', color: '#8b5cf6' },
  { name: 'Business', type: 'income', icon: 'FaBriefcase', color: '#f59e0b' },
  { name: 'Gifts & Grants', type: 'income', icon: 'FaGift', color: '#ec4899' },
  { name: 'Balance Adjustment', type: 'income', icon: 'FaSlidersH', color: '#64748b' },
  { name: 'Other Income', type: 'income', icon: 'FaCoins', color: '#14b8a6' }
];

const PAYMENT_METHODS = [
  'Cash',
  'Credit Card',
  'Debit Card',
  'UPI',
  'Bank Transfer',
  'Net Banking',
  'Other'
];

const RECURRING_FREQUENCIES = ['weekly', 'monthly', 'yearly'];
const GOAL_STATUSES = ['in_progress', 'completed', 'cancelled'];
const HOUSEHOLD_ROLES = ['owner', 'admin', 'member'];

module.exports = {
  DEFAULT_CATEGORIES,
  PAYMENT_METHODS,
  RECURRING_FREQUENCIES,
  GOAL_STATUSES,
  HOUSEHOLD_ROLES
};
