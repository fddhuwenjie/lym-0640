const express = require('express');
const router = express.Router();
const inspectionService = require('../services/inspectionService');
const { asyncHandler } = require('../middleware/errorHandler');

router.post('/', asyncHandler((req, res) => {
  const result = inspectionService.inspectContainer(req.body);
  res.json({
    success: true,
    data: result,
    message: '查验完成',
  });
}));

router.get('/history', asyncHandler((req, res) => {
  const { containerNo, page, pageSize } = req.query;

  const result = inspectionService.getInspectionHistory(
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
  const result = inspectionService.getInspectionStats(startDate, endDate);
  res.json({
    success: true,
    data: result,
  });
}));

router.get('/pending', asyncHandler((req, res) => {
  const { page, pageSize } = req.query;

  const result = inspectionService.getPendingInspectionContainers(
    page ? parseInt(page) : 1,
    pageSize ? parseInt(pageSize) : 20
  );

  res.json({
    success: true,
    data: result,
  });
}));

module.exports = router;
