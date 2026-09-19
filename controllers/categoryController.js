const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');
const { logActivity } = require('../services/activityService');

// @desc    Get all categories (defaults + user custom)
// @route   GET /api/v1/categories
// @access  Private
const getCategories = async (req, res, next) => {
  try {
    const categories = await Category.find({
      $or: [{ isDefault: true }, { user: req.user.id }],
    }).sort({ type: 1, name: 1 });

    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create custom category
// @route   POST /api/v1/categories
// @access  Private
const createCategory = async (req, res, next) => {
  try {
    const { name, type, icon, color } = req.body;

    if (!name || !type) {
      return res.status(400).json({
        success: false,
        message: 'Name and type (income or expense) are required',
      });
    }

    // Check duplicate for this user or default
    const existing = await Category.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      type,
      $or: [{ isDefault: true }, { user: req.user.id }],
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A category named "${name}" already exists for ${type}`,
      });
    }

    const category = await Category.create({
      name: name.trim(),
      type,
      icon: icon || 'FaTag',
      color: color || '#3b82f6',
      isDefault: false,
      user: req.user.id,
    });

    await logActivity(req.user.id, 'CATEGORY_CREATE', `Created custom category: ${name}`);

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update custom category
// @route   PUT /api/v1/categories/:id
// @access  Private
const updateCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    if (category.isDefault) {
      return res.status(403).json({
        success: false,
        message: 'System default categories cannot be modified',
      });
    }

    if (category.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this category',
      });
    }

    const { name, icon, color } = req.body;
    if (name) category.name = name.trim();
    if (icon) category.icon = icon;
    if (color) category.color = color;

    await category.save();

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete custom category
// @route   DELETE /api/v1/categories/:id
// @access  Private
const deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    if (category.isDefault) {
      return res.status(403).json({
        success: false,
        message: 'System default categories cannot be deleted',
      });
    }

    if (category.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this category',
      });
    }

    // Safety check: is it in use?
    const transactionCount = await Transaction.countDocuments({ category: category._id });
    if (transactionCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category: it is currently used in ${transactionCount} transaction(s). Reassign them first.`,
      });
    }

    const budgetCount = await Budget.countDocuments({ category: category._id });
    if (budgetCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category: it is currently referenced in ${budgetCount} budget(s).`,
      });
    }

    await Category.findByIdAndDelete(req.params.id);

    await logActivity(req.user.id, 'CATEGORY_DELETE', `Deleted category: ${category.name}`);

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully',
      data: {},
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
