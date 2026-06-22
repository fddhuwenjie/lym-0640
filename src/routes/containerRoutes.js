const express = require('express');
const router = express.Router();
const containerService = require('../services/containerService');
const { asyncHandler } = require('../middleware/errorHandler');

router.post('/arrival', asyncHandler((req, res) => {
  const result = containerService.containerArrival(req.body);
  res.json({
    success: true,
    data: result,
    message: '集装箱进场成功',
  });
}));

router.post('/:containerNo/departure', asyncHandler((req, res) => {
  const { containerNo } = req.params;
  const { operator } = req.body || {};
  const result = containerService.containerDeparture(containerNo, operator);
  res.json({
    success: true,
    data: result,
    message: '集装箱出场成功',
  });
}));

router.get('/:containerNo', asyncHandler((req, res) => {
  const { containerNo } = req.params;
  const container = containerService.getContainer(containerNo);
  if (!container) {
    return res.status(404).json({
      success: false,
      error: `箱号 ${containerNo} 不存在`,
    });
  }
  res.json({
    success: true,
    data: container,
  });
}));

router.get('/', asyncHandler((req, res) => {
  const { status, feeStatus, inspectionStatus, isDangerous, containerType, page, pageSize } = req.query;

  const params = {
    status,
    feeStatus,
    inspectionStatus,
    containerType,
    page: page ? parseInt(page) : 1,
    pageSize: pageSize ? parseInt(pageSize) : 20,
  };

  if (isDangerous !== undefined) {
    params.isDangerous = isDangerous === 'true' || isDangerous === '1';
  }

  const result = containerService.getContainerList(params);
  res.json({
    success: true,
    data: result,
  });
}));

router.post('/:containerNo/lock', asyncHandler((req, res) => {
  const { containerNo } = req.params;
  const { reason } = req.body || {};
  const result = containerService.lockContainer(containerNo, reason);
  res.json({
    success: true,
    data: result,
    message: '集装箱锁定成功',
  });
}));

router.post('/:containerNo/unlock', asyncHandler((req, res) => {
  const { containerNo } = req.params;
  const result = containerService.unlockContainer(containerNo);
  res.json({
    success: true,
    data: result,
    message: '集装箱解锁成功',
  });
}));

module.exports = router;
