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

router.get('/config/rules', asyncHandler((req, res) => {
  const { containerType, isDangerous } = req.query;
  const params = {
    containerType,
  };
  if (isDangerous !== undefined) {
    params.isDangerous = isDangerous === 'true' || isDangerous === '1';
  }
  const list = slotService.getZoneConfigList(params.containerType, params.isDangerous);
  res.json({
    success: true,
    data: list,
  });
}));

router.post('/config/rules', asyncHandler((req, res) => {
  const { container_type, is_dangerous, zone, priority, slot_container_type, remark } = req.body;
  if (!container_type || is_dangerous === undefined || !zone || priority === undefined || !slot_container_type) {
    return res.status(400).json({
      success: false,
      error: '缺少必填字段: container_type, is_dangerous, zone, priority, slot_container_type',
    });
  }
  const id = slotService.addZoneConfig({ container_type, is_dangerous, zone, priority, slot_container_type, remark });
  res.json({
    success: true,
    data: { id },
    message: '堆区分配规则已添加',
  });
}));

router.delete('/config/rules/:id', asyncHandler((req, res) => {
  const id = parseInt(req.params.id);
  const ok = slotService.deleteZoneConfig(id);
  if (!ok) {
    return res.status(404).json({ success: false, error: `规则ID ${id} 不存在` });
  }
  res.json({ success: true, message: `规则ID ${id} 已删除` });
}));

module.exports = router;
