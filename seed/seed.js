const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: __dirname + '/../.env' });

const User = require('../models/User');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');
const Recurring = require('../models/Recurring');
const Goal = require('../models/Goal');
const Household = require('../models/Household');
const Invitation = require('../models/Invitation');
const ActivityLog = require('../models/ActivityLog');
const { DEFAULT_CATEGORIES } = require('../config/constants');

const seedData = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/fintrack';
    await mongoose.connect(mongoUri);
    console.log('[Seed] Connected to MongoDB at:', mongoUri);

    // 1. Clean existing collections
    console.log('[Seed] Cleaning existing data...');
    await User.deleteMany({});
    await Category.deleteMany({});
    await Transaction.deleteMany({});
    await Budget.deleteMany({});
    await Recurring.deleteMany({});
    await Goal.deleteMany({});
    await Household.deleteMany({});
    await Invitation.deleteMany({});
    await ActivityLog.deleteMany({});

    // 2. Insert Default Categories
    console.log('[Seed] Creating default categories...');
    const createdCategories = await Category.insertMany(
      DEFAULT_CATEGORIES.map((cat) => ({
        ...cat,
        isDefault: true,
        user: null,
      }))
    );

    const categoryMap = {};
    createdCategories.forEach((c) => {
      categoryMap[c.name] = c;
    });

    // 3. Create Users
    console.log('[Seed] Creating demo users...');
    const demoUser = await User.create({
      name: 'Aarav Sharma',
      email: 'demo@fintrack.com',
      password: 'Password123!',
      currency: 'INR',
      startingBalance: 25000,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    });

    const partnerUser = await User.create({
      name: 'Priya Sharma',
      email: 'priya@fintrack.com',
      password: 'Password123!',
      currency: 'INR',
      startingBalance: 15000,
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    });

    // 4. Create Household
    console.log('[Seed] Creating demo household...');
    const household = await Household.create({
      name: 'Sharma Family Household',
      owner: demoUser._id,
      members: [
        { user: demoUser._id, role: 'owner', joinedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
        { user: partnerUser._id, role: 'admin', joinedAt: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000) },
      ],
    });

    demoUser.activeHousehold = household._id;
    await demoUser.save({ validateBeforeSave: false });

    partnerUser.activeHousehold = household._id;
    await partnerUser.save({ validateBeforeSave: false });

    // 5. Seed Transactions across 4 months (current and past 3 months)
    console.log('[Seed] Generating realistic transaction history...');
    const transactions = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed

    // Helper to generate a date in a given month offset (0 = current, 1 = last month, etc.)
    const makeDate = (monthsAgo, day, hour = 12) => {
      const d = new Date(currentYear, currentMonth - monthsAgo, day, hour, 30);
      return d;
    };

    // Month patterns: 0 (current), 1 (last month), 2 (2 months ago), 3 (3 months ago)
    for (let m = 3; m >= 0; m--) {
      // Monthly Salary
      transactions.push({
        user: demoUser._id,
        type: 'income',
        amount: 125000,
        category: categoryMap['Salary']._id,
        description: 'Monthly Tech Salary - Initech Corp',
        paymentMethod: 'Bank Transfer',
        date: makeDate(m, 1, 9),
        notes: 'Direct deposit after tax deductions',
      });

      // Freelance Income (some months)
      if (m !== 1) {
        transactions.push({
          user: demoUser._id,
          type: 'income',
          amount: m === 0 ? 32000 : 28000,
          category: categoryMap['Freelance']._id,
          description: 'UI/UX & Fullstack Client Retainer',
          paymentMethod: 'UPI',
          date: makeDate(m, 14, 16),
          notes: 'Milestone 2 payout',
        });
      }

      // Rent / Housing (Shared)
      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 32000,
        category: categoryMap['Housing & Rent']._id,
        description: 'Monthly Apartment Rent',
        paymentMethod: 'Net Banking',
        date: makeDate(m, 3, 10),
        notes: 'Paid to landlord via NEFT',
        household: household._id,
        isShared: true,
      });

      // Groceries (Nature Basket, Blinkit, Supermarket)
      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 4250,
        category: categoryMap['Groceries']._id,
        description: 'Nature Basket Supermarket',
        paymentMethod: 'Credit Card',
        date: makeDate(m, 5, 18),
        household: household._id,
        isShared: true,
      });

      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 2890,
        category: categoryMap['Groceries']._id,
        description: 'Blinkit Instant Grocery Delivery',
        paymentMethod: 'UPI',
        date: makeDate(m, 15, 11),
      });

      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 3800,
        category: categoryMap['Groceries']._id,
        description: 'Weekly Organic Veggies & Staples',
        paymentMethod: 'UPI',
        date: makeDate(m, 24, 19),
        household: household._id,
        isShared: true,
      });

      // Food & Dining (Dining out, Coffee, Swiggy)
      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 2150,
        category: categoryMap['Food & Dining']._id,
        description: 'Weekend Bistro Dinner',
        paymentMethod: 'Credit Card',
        date: makeDate(m, 8, 21),
      });

      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 850,
        category: categoryMap['Food & Dining']._id,
        description: 'Third Wave Coffee Roasters',
        paymentMethod: 'UPI',
        date: makeDate(m, 12, 15),
      });

      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 1420,
        category: categoryMap['Food & Dining']._id,
        description: 'Swiggy Gourmet Order',
        paymentMethod: 'Debit Card',
        date: makeDate(m, 22, 20),
      });

      // Bills & Utilities
      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 3200,
        category: categoryMap['Bills & Utilities']._id,
        description: 'Electricity Board Bill',
        paymentMethod: 'UPI',
        date: makeDate(m, 7, 14),
        household: household._id,
        isShared: true,
      });

      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 1299,
        category: categoryMap['Bills & Utilities']._id,
        description: 'Airtel Fiber Gigabit Broadband',
        paymentMethod: 'Credit Card',
        date: makeDate(m, 10, 10),
        household: household._id,
        isShared: true,
      });

      // Transport
      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 3500,
        category: categoryMap['Transport']._id,
        description: 'Shell Fuel Station - Full Tank',
        paymentMethod: 'Credit Card',
        date: makeDate(m, 9, 8),
      });

      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 720,
        category: categoryMap['Transport']._id,
        description: 'Uber Premier to Airport/Meeting',
        paymentMethod: 'UPI',
        date: makeDate(m, 18, 17),
      });

      // Shopping
      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 4599,
        category: categoryMap['Shopping']._id,
        description: 'Amazon Electronics & Home Essentials',
        paymentMethod: 'Credit Card',
        date: makeDate(m, 11, 14),
      });

      // Entertainment
      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 649,
        category: categoryMap['Entertainment']._id,
        description: 'Netflix 4K Premium Subscription',
        paymentMethod: 'Credit Card',
        date: makeDate(m, 16, 2),
      });

      transactions.push({
        user: demoUser._id,
        type: 'expense',
        amount: 1200,
        category: categoryMap['Entertainment']._id,
        description: 'PVR IMAX Movie Tickets',
        paymentMethod: 'Credit Card',
        date: makeDate(m, 20, 19),
      });

      // Partner User shared contributions
      transactions.push({
        user: partnerUser._id,
        type: 'expense',
        amount: 5400,
        category: categoryMap['Groceries']._id,
        description: 'Costco Wholesale Household Stock',
        paymentMethod: 'Credit Card',
        date: makeDate(m, 13, 16),
        household: household._id,
        isShared: true,
      });
    }

    await Transaction.insertMany(transactions);
    console.log(`[Seed] Inserted ${transactions.length} transactions across 4 months.`);

    // 6. Budgets for Current and Last Month
    console.log('[Seed] Setting up budgets...');
    const curMonthNum = currentMonth + 1;
    const lastMonthNum = curMonthNum === 1 ? 12 : curMonthNum - 1;
    const lastMonthYear = curMonthNum === 1 ? currentYear - 1 : currentYear;

    const budgetsData = [
      // Current Month
      { user: demoUser._id, category: categoryMap['Housing & Rent']._id, month: curMonthNum, year: currentYear, amount: 35000 },
      { user: demoUser._id, category: categoryMap['Groceries']._id, month: curMonthNum, year: currentYear, amount: 15000 },
      { user: demoUser._id, category: categoryMap['Food & Dining']._id, month: curMonthNum, year: currentYear, amount: 8000 },
      { user: demoUser._id, category: categoryMap['Bills & Utilities']._id, month: curMonthNum, year: currentYear, amount: 6000 },
      { user: demoUser._id, category: categoryMap['Transport']._id, month: curMonthNum, year: currentYear, amount: 6000 },
      { user: demoUser._id, category: categoryMap['Shopping']._id, month: curMonthNum, year: currentYear, amount: 8000 },
      { user: demoUser._id, category: categoryMap['Entertainment']._id, month: curMonthNum, year: currentYear, amount: 3000 },

      // Last Month
      { user: demoUser._id, category: categoryMap['Housing & Rent']._id, month: lastMonthNum, year: lastMonthYear, amount: 35000 },
      { user: demoUser._id, category: categoryMap['Groceries']._id, month: lastMonthNum, year: lastMonthYear, amount: 14000 },
      { user: demoUser._id, category: categoryMap['Food & Dining']._id, month: lastMonthNum, year: lastMonthYear, amount: 8000 },
      { user: demoUser._id, category: categoryMap['Bills & Utilities']._id, month: lastMonthNum, year: lastMonthYear, amount: 6000 },
    ];

    await Budget.insertMany(budgetsData);

    // 7. Recurring Transactions
    console.log('[Seed] Creating recurring rules...');
    const recurringData = [
      {
        user: demoUser._id,
        type: 'income',
        amount: 125000,
        category: categoryMap['Salary']._id,
        description: 'Monthly Initech Corp Salary',
        paymentMethod: 'Bank Transfer',
        frequency: 'monthly',
        startDate: new Date(currentYear, currentMonth, 1),
        nextDueDate: new Date(currentYear, currentMonth + 1, 1),
        isActive: true,
      },
      {
        user: demoUser._id,
        type: 'expense',
        amount: 32000,
        category: categoryMap['Housing & Rent']._id,
        description: 'Apartment Lease Payment',
        paymentMethod: 'Net Banking',
        frequency: 'monthly',
        startDate: new Date(currentYear, currentMonth, 3),
        nextDueDate: new Date(currentYear, currentMonth + 1, 3),
        isActive: true,
      },
      {
        user: demoUser._id,
        type: 'expense',
        amount: 1299,
        category: categoryMap['Bills & Utilities']._id,
        description: 'Airtel Fiber Broadband',
        paymentMethod: 'Credit Card',
        frequency: 'monthly',
        startDate: new Date(currentYear, currentMonth, 10),
        nextDueDate: new Date(currentYear, currentMonth + 1, 10),
        isActive: true,
      },
      {
        user: demoUser._id,
        type: 'expense',
        amount: 649,
        category: categoryMap['Entertainment']._id,
        description: 'Netflix 4K Family Plan',
        paymentMethod: 'Credit Card',
        frequency: 'monthly',
        startDate: new Date(currentYear, currentMonth, 16),
        nextDueDate: new Date(currentYear, currentMonth + 1, 16),
        isActive: true,
      },
      {
        user: demoUser._id,
        type: 'expense',
        amount: 2500,
        category: categoryMap['Health & Medical']._id,
        description: 'Gold Gym Fitness Membership',
        paymentMethod: 'UPI',
        frequency: 'monthly',
        startDate: new Date(currentYear, currentMonth, 20),
        nextDueDate: new Date(currentYear, currentMonth + 1, 20),
        isActive: true,
      },
    ];

    await Recurring.insertMany(recurringData);

    // 8. Financial Goals
    console.log('[Seed] Creating financial savings goals...');
    const goalsData = [
      {
        user: demoUser._id,
        name: 'Emergency Reserve Fund (6 Months)',
        targetAmount: 300000,
        currentSavedAmount: 210000,
        targetDate: new Date(currentYear, currentMonth + 6, 15),
        category: 'Emergency',
        description: 'High-yield liquid savings buffer for unforeseen life events',
        status: 'in_progress',
        contributions: [
          { amount: 100000, date: new Date(currentYear, currentMonth - 2, 1), note: 'Initial seed deposit' },
          { amount: 60000, date: new Date(currentYear, currentMonth - 1, 2), note: 'Bonus contribution' },
          { amount: 50000, date: new Date(currentYear, currentMonth, 2), note: 'Regular monthly savings' },
        ],
      },
      {
        user: demoUser._id,
        name: 'Apple MacBook Pro M3 Max',
        targetAmount: 180000,
        currentSavedAmount: 140000,
        targetDate: new Date(currentYear, currentMonth + 2, 30),
        category: 'Workstation Tech',
        description: 'Upgrading mobile development and AI workflow workstation',
        status: 'in_progress',
        contributions: [
          { amount: 80000, date: new Date(currentYear, currentMonth - 1, 15), note: 'Freelance project 1' },
          { amount: 60000, date: new Date(currentYear, currentMonth, 15), note: 'Freelance project 2' },
        ],
      },
      {
        user: demoUser._id,
        name: 'Goa Holiday Getaway',
        targetAmount: 60000,
        currentSavedAmount: 60000,
        targetDate: new Date(currentYear, currentMonth, 28),
        category: 'Travel & Leisure',
        description: 'Beachside resort family vacation fund',
        status: 'completed',
        contributions: [
          { amount: 30000, date: new Date(currentYear, currentMonth - 2, 20), note: 'Savings allocation' },
          { amount: 30000, date: new Date(currentYear, currentMonth - 1, 25), note: 'Goal completed deposit' },
        ],
      },
      {
        user: demoUser._id,
        name: 'Dream Apartment Down Payment',
        targetAmount: 1500000,
        currentSavedAmount: 480000,
        targetDate: new Date(currentYear + 2, 11, 31),
        category: 'Real Estate',
        description: 'Targeting 20% down payment on 3BHK home purchase',
        status: 'in_progress',
        contributions: [
          { amount: 350000, date: new Date(currentYear - 1, 11, 15), note: 'Annual bonus deposit' },
          { amount: 130000, date: new Date(currentYear, currentMonth - 1, 5), note: 'Investments liquidation' },
        ],
      },
    ];

    await Goal.insertMany(goalsData);

    // 9. Activity Logs
    console.log('[Seed] Generating initial activity logs...');
    const logs = [
      { user: demoUser._id, action: 'USER_REGISTER', description: 'Account registered' },
      { user: demoUser._id, action: 'HOUSEHOLD_CREATE', description: 'Created household "Sharma Family Household"' },
      { user: demoUser._id, action: 'HOUSEHOLD_INVITE', description: 'Invited Priya Sharma to household' },
      { user: demoUser._id, action: 'GOAL_CREATE', description: 'Created savings goal "Emergency Reserve Fund"' },
      { user: demoUser._id, action: 'BUDGET_CREATE', description: 'Set monthly budget limits' },
      { user: demoUser._id, action: 'TRANSACTION_CREATE', description: 'Recorded salary income of ₹1,25,000' },
      { user: demoUser._id, action: 'GOAL_CONTRIBUTION', description: 'Contributed ₹50,000 towards Emergency Reserve Fund' },
    ];

    await ActivityLog.insertMany(logs);

    console.log('====================================================');
    console.log(' FINTRACK DATABASE SEED COMPLETED SUCCESSFULLY!');
    console.log(' Demo Login Credentials:');
    console.log('   Email:    demo@fintrack.com');
    console.log('   Password: Password123!');
    console.log(' Partner Login Credentials:');
    console.log('   Email:    priya@fintrack.com');
    console.log('   Password: Password123!');
    console.log('====================================================');

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('[Seed Error]:', err);
    process.exit(1);
  }
};

seedData();
