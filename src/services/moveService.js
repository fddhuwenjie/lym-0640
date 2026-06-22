const { db } = require('../db');
const slotService = require('./slotService');
const containerService = require('./containerService');

function moveContainer(containerNo, targetSlot, operator, reason) {
  const container = containerService.getContainer(containerNo);
  if (!container) {
    throw new Error(`箱号 ${containerNo} 不存在`);
  }

  if (container.status === 'departed') {
    throw new Error(`箱号 ${containerNo} 已出场，无法移箱`);
  }

  if (container.status === 'locked') {
    throw new Error(`箱号 ${containerNo} 已被锁定，无法移箱`);
  }

  const sourceSlot = container.current_slot;
  if (sourceSlot === targetSlot) {
    throw new Error('目标堆位与当前堆位相同，无需移箱');
  }

  const targetSlotInfo = slotService.getSlotInfo(targetSlot);
  if (!targetSlotInfo) {
    throw new Error(`目标堆位 ${targetSlot} 不存在`);
  }

  if (targetSlotInfo.is_occupied) {
    throw new Error(`目标堆位 ${targetSlot} 已被占用`);
  }

  if (targetSlotInfo.is_sealed) {
    throw new Error(`目标堆位 ${targetSlot} 已被封闭，无法使用`);
  }

  if (targetSlotInfo.container_type !== container.container_type) {
    throw new Error(`目标堆位 ${targetSlot} 为 ${targetSlotInfo.container_type} 箱型，与集装箱箱型 ${container.container_type} 不匹配`);
  }

  const normalZones = ['A', 'B', 'C'];
  const dangerousZones = ['D', 'E'];
  const targetZone = targetSlotInfo.zone;

  if (container.is_dangerous && normalZones.includes(targetZone)) {
    throw new Error(`危险品集装箱不能放入普通区 ${targetZone} 区`);
  }

  if (!container.is_dangerous && dangerousZones.includes(targetZone)) {
    throw new Error(`普通集装箱不能放入危险品区 ${targetZone} 区`);
  }

  const transaction = db.transaction(() => {
    slotService.releaseSlot(sourceSlot);
    slotService.occupySlot(targetSlot, containerNo);

    db.prepare(`
      UPDATE containers 
      SET current_slot = ?, updated_at = datetime('now', 'localtime')
      WHERE container_no = ?
    `).run(targetSlot, containerNo);

    db.prepare(`
      INSERT INTO move_records (container_no, from_slot, to_slot, move_type, operator, reason)
      VALUES (?, ?, ?, '移箱', ?, ?)
    `).run(containerNo, sourceSlot, targetSlot, operator || 'system', reason || '正常移箱');
  });

  transaction();

  return {
    containerNo,
    fromSlot: sourceSlot,
    toSlot: targetSlot,
    moveTime: new Date().toLocaleString('zh-CN'),
  };
}

function getMoveHistory(containerNo, page = 1, pageSize = 20) {
  let whereClause = '';
  let queryParams = [];

  if (containerNo) {
    whereClause = 'WHERE container_no = ?';
    queryParams.push(containerNo);
  }

  const countQuery = `SELECT COUNT(*) as total FROM move_records ${whereClause}`;
  const total = db.prepare(countQuery).get(...queryParams).total;

  const offset = (page - 1) * pageSize;
  const listQuery = `
    SELECT * FROM move_records ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  queryParams.push(pageSize, offset);

  const list = db.prepare(listQuery).all(...queryParams);

  return { list, total, page, pageSize };
}

function getMoveStats(startDate, endDate) {
  let whereClause = '';
  let params = [];

  if (startDate && endDate) {
    whereClause = 'WHERE created_at BETWEEN ? AND ?';
    params.push(startDate, endDate);
  }

  const query = `
    SELECT 
      move_type,
      COUNT(*) as count
    FROM move_records
    ${whereClause}
    GROUP BY move_type
    ORDER BY count DESC
  `;

  return db.prepare(query).all(...params);
}

module.exports = {
  moveContainer,
  getMoveHistory,
  getMoveStats,
};
