const express = require('express');
const router = express.Router();
const exportService = require('../services/exportService');
const { asyncHandler } = require('../middleware/errorHandler');

router.post('/departure-list', asyncHandler(async (req, res) => {
  const { startDate, endDate, createdBy } = req.body || {};
  const result = await exportService.exportDepartureList({ startDate, endDate, createdBy });
  res.json({
    success: true,
    data: result,
    message: '出场清单导出成功',
  });
}));

router.post('/yard-occupancy', asyncHandler(async (req, res) => {
  const { createdBy } = req.body || {};
  const result = await exportService.exportYardOccupancy(createdBy);
  res.json({
    success: true,
    data: result,
    message: '堆场占用报表导出成功',
  });
}));

router.get('/', asyncHandler((req, res) => {
  const { page, pageSize } = req.query;

  const result = exportService.getExportList(
    page ? parseInt(page) : 1,
    pageSize ? parseInt(pageSize) : 20
  );

  res.json({
    success: true,
    data: result,
  });
}));

router.get('/:id', asyncHandler((req, res) => {
  const { id } = req.params;
  const result = exportService.getExportFile(parseInt(id));
  res.json({
    success: true,
    data: result,
  });
}));

module.exports = router;
