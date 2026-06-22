const express = require('express');
const router = express.Router();
const moveService = require('../services/moveService');
const { asyncHandler } = require('../middleware/errorHandler');

router.post('/', asyncHandler((req, res) => {
  const { containerNo, targetSlot, operator, reason } = req.body;

  if (!containerNo || !targetSlot) {
    return res.status(400).json({
      success: false,
      error: '箱号(containerNo)和目标堆位(targetSlot)不能为空',
    });
  }

  const result = moveService.moveContainer(containerNo, targetSlot, operator, reason);
  res.json({
    success: true,
    data: result,
    message: '移箱成功',
  });
}));

router.get('/history', asyncHandler((req, res) => {
  const { containerNo, page, pageSize } = req.query;

  const result = moveService.getMoveHistory(
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
  const result = moveService.getMoveStats(startDate, endDate);
  res.json({
    success: true,
    data: result,
  });
}));

module.exports = router;
