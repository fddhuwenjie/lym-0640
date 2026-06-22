const express = require('express');
const router = express.Router();
const slotService = require('../services/slotService');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/occupancy', asyncHandler((req, res) => {
  const { zone } = req.query;
  const result = slotService.getYardOccupancy(zone);
  res.json({
    success: true,
    data: result,
  });
}));

router.get('/', asyncHandler((req, res) => {
  const { zone, isOccupied, isSealed, containerType, page, pageSize } = req.query;

  const params = {
    zone,
    containerType,
    page: page ? parseInt(page) : 1,
    pageSize: pageSize ? parseInt(pageSize) : 20,
  };

  if (isOccupied !== undefined) {
    params.isOccupied = isOccupied === 'true' || isOccupied === '1';
  }
  if (isSealed !== undefined) {
    params.isSealed = isSealed === 'true' || isSealed === '1';
  }

  const result = slotService.getSlotList(params);
  res.json({
    success: true,
    data: result,
  });
}));

router.get('/:slotCode', asyncHandler((req, res) => {
  const { slotCode } = req.params;
  const slot = slotService.getSlotInfo(slotCode);
  if (!slot) {
    return res.status(404).json({
      success: false,
      error: `堆位 ${slotCode} 不存在`,
    });
  }
  res.json({
    success: true,
    data: slot,
  });
}));

router.post('/zone/:zone/seal', asyncHandler((req, res) => {
  const { zone } = req.params;
  const { reason } = req.body || {};
  const result = slotService.sealZone(zone, reason);
  res.json({
    success: true,
    data: result,
    message: `堆区 ${zone} 封闭成功`,
  });
}));

router.post('/zone/:zone/unseal', asyncHandler((req, res) => {
  const { zone } = req.params;
  const result = slotService.unsealZone(zone);
  res.json({
    success: true,
    data: result,
    message: `堆区 ${zone} 解封成功`,
  });
}));

router.post('/:slotCode/seal', asyncHandler((req, res) => {
  const { slotCode } = req.params;
  const { reason } = req.body || {};
  const result = slotService.sealSlot(slotCode, reason);
  res.json({
    success: true,
    data: result,
    message: `堆位 ${slotCode} 封闭成功`,
  });
}));

router.post('/:slotCode/unseal', asyncHandler((req, res) => {
  const { slotCode } = req.params;
  const result = slotService.unsealSlot(slotCode);
  res.json({
    success: true,
    data: result,
    message: `堆位 ${slotCode} 解封成功`,
  });
}));

router.get('/available/count', asyncHandler((req, res) => {
  const { containerType, isDangerous } = req.query;

  if (!containerType) {
    return res.status(400).json({
      success: false,
      error: '请提供箱型参数 containerType',
    });
  }

  const dangerous = isDangerous === 'true' || isDangerous === '1';
  const count = slotService.getAvailableSlotCount(containerType, dangerous);

  res.json({
    success: true,
    data: {
      containerType,
      isDangerous: dangerous,
      availableCount: count,
    },
  });
}));

module.exports = router;
