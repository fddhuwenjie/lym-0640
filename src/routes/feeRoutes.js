const express = require('express');
const router = express.Router();
const feeService = require('../services/feeService');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/calculate/:containerNo', asyncHandler((req, res) => {
  const { containerNo } = req.params;
  const result = feeService.calculateStorageFee(containerNo);
  res.json({
    success: true,
    data: result,
  });
}));

router.post('/pay', asyncHandler((req, res) => {
  const { containerNo, amount, paymentMethod, operator } = req.body;

  if (!containerNo || !amount) {
    return res.status(400).json({
      success: false,
      error: '箱号(containerNo)和金额(amount)不能为空',
    });
  }

  const result = feeService.payFee(containerNo, parseFloat(amount), paymentMethod, operator);
  res.json({
    success: true,
    data: result,
    message: '缴费成功',
  });
}));

router.get('/records', asyncHandler((req, res) => {
  const { containerNo, page, pageSize } = req.query;

  const result = feeService.getFeeRecords(
    containerNo,
    page ? parseInt(page) : 1,
    pageSize ? parseInt(pageSize) : 20
  );

  res.json({
    success: true,
    data: result,
  });
}));

router.get('/stats', asyncHandler((req, res) => {
  const { startDate, endDate } = req.query;
  const result = feeService.getStorageFeeStats(startDate, endDate);
  res.json({
    success: true,
    data: result,
  });
}));

router.get('/overdue', asyncHandler((req, res) => {
  const { page, pageSize } = req.query;

  const result = feeService.getOverdueContainers(
    page ? parseInt(page) : 1,
    pageSize ? parseInt(pageSize) : 20
  );

  res.json({
    success: true,
    data: result,
  });
}));

module.exports = router;
