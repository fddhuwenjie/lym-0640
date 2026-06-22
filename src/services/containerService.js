const { db } = require('../db');
const slotService = require('./slotService');
const feeService = require('./feeService');

function getContainer(containerNo) {
  return db.prepare('SELECT * FROM containers WHERE container_no = ?').get(containerNo);
}

function containerArrival(data) {
  const { 
    containerNo, 
    containerType, 
    isDangerous = false, 
    estimatedDepartureTime,
    operator 
  } = data;

  if (!containerNo || !containerType) {
    throw new Error('箱号和箱型不能为空');
  }

  const validTypes = ['20GP', '40GP', '40HQ'];
  if (!validTypes.includes(containerType)) {
    throw new Error(`不支持的箱型: ${containerType}，支持的箱型: ${validTypes.join('、')}`);
  }

  const existing = getContainer(containerNo);
  if (existing && existing.status !== 'departed') {
    throw new Error(`箱号 ${containerNo} 已在场内，状态: ${getStatusText(existing.status)}，禁止重复进场`);
  }

  const slot = slotService.allocateSlot(containerType, isDangerous, estimatedDepartureTime);

  const transaction = db.transaction(() => {
    slotService.occupySlot(slot.slot_code, containerNo);

    if (existing && existing.status === 'departed') {
      db.prepare(`
        UPDATE containers 
        SET status = 'in_yard',
            container_type = ?,
            is_dangerous = ?,
            current_slot = ?,
            departure_slot = NULL,
            arrival_time = datetime('now', 'localtime'),
            estimated_departure_time = ?,
            actual_departure_time = NULL,
            fee_status = 'unpaid',
            total_fee = 0,
            paid_amount = 0,
            inspection_status = 'pending',
            inspection_conclusion = NULL,
            updated_at = datetime('now', 'localtime')
        WHERE container_no = ?
      `).run(containerType, isDangerous ? 1 : 0, slot.slot_code, estimatedDepartureTime, containerNo);
    } else {
      db.prepare(`
        INSERT INTO containers 
          (container_no, container_type, is_dangerous, status, current_slot, 
           arrival_time, estimated_departure_time, fee_status, inspection_status)
        VALUES (?, ?, ?, 'in_yard', ?, datetime('now', 'localtime'), ?, 'unpaid', 'pending')
      `).run(containerNo, containerType, isDangerous ? 1 : 0, slot.slot_code, estimatedDepartureTime);
    }

    db.prepare(`
      INSERT INTO move_records (container_no, from_slot, to_slot, move_type, operator, reason)
      VALUES (?, NULL, ?, '进场', ?, '集装箱进场')
    `).run(containerNo, slot.slot_code, operator || 'system');
  });

  transaction();

  return {
    containerNo,
    slot: slot.slot_code,
    zone: slot.zone,
    arrivalTime: new Date().toLocaleString('zh-CN'),
  };
}

function containerDeparture(containerNo, operator) {
  const container = getContainer(containerNo);

  if (!container) {
    throw new Error(`箱号 ${containerNo} 不存在`);
  }

  if (container.status === 'departed') {
    throw new Error(`箱号 ${containerNo} 已经出场`);
  }

  if (container.status === 'locked') {
    throw new Error(`箱号 ${containerNo} 已被锁定，无法出场`);
  }

  if (container.inspection_status !== 'passed') {
    if (container.inspection_status === 'pending') {
      throw new Error(`箱号 ${containerNo} 尚未完成查验，禁止出场`);
    }
    if (container.inspection_status === 'failed') {
      throw new Error(`箱号 ${containerNo} 查验未通过，禁止出场`);
    }
  }

  feeService.calculateStorageFee(containerNo);
  const updatedContainer = getContainer(containerNo);

  if (updatedContainer.fee_status !== 'paid') {
    const unpaid = updatedContainer.total_fee - updatedContainer.paid_amount;
    throw new Error(`箱号 ${containerNo} 存在未结清费用 ${unpaid.toFixed(2)}元，禁止出场`);
  }

  const transaction = db.transaction(() => {
    const slotBeforeDeparture = container.current_slot;
    slotService.releaseSlot(slotBeforeDeparture);

    db.prepare(`
      UPDATE containers 
      SET status = 'departed',
          current_slot = NULL,
          departure_slot = ?,
          actual_departure_time = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
      WHERE container_no = ?
    `).run(slotBeforeDeparture, containerNo);

    db.prepare(`
      INSERT INTO move_records (container_no, from_slot, to_slot, move_type, operator, reason)
      VALUES (?, ?, NULL, '出场', ?, '集装箱出场放行')
    `).run(containerNo, slotBeforeDeparture, operator || 'system');
  });

  transaction();

  return {
    containerNo,
    departureTime: new Date().toLocaleString('zh-CN'),
    totalFee: updatedContainer.total_fee,
    paidAmount: updatedContainer.paid_amount,
  };
}

function getContainerList(params = {}) {
  const { 
    status, 
    feeStatus, 
    inspectionStatus,
    isDangerous,
    containerType,
    page = 1, 
    pageSize = 20 
  } = params;

  let whereClause = [];
  let queryParams = [];

  if (status) {
    whereClause.push('status = ?');
    queryParams.push(status);
  }
  if (feeStatus) {
    whereClause.push('fee_status = ?');
    queryParams.push(feeStatus);
  }
  if (inspectionStatus) {
    whereClause.push('inspection_status = ?');
    queryParams.push(inspectionStatus);
  }
  if (isDangerous !== undefined) {
    whereClause.push('is_dangerous = ?');
    queryParams.push(isDangerous ? 1 : 0);
  }
  if (containerType) {
    whereClause.push('container_type = ?');
    queryParams.push(containerType);
  }

  let whereSql = '';
  if (whereClause.length > 0) {
    whereSql = ' WHERE ' + whereClause.join(' AND ');
  }

  const countQuery = `SELECT COUNT(*) as total FROM containers${whereSql}`;
  const total = db.prepare(countQuery).get(...queryParams).total;

  const offset = (page - 1) * pageSize;
  const listQuery = `
    SELECT * FROM containers${whereSql}
    ORDER BY arrival_time DESC
    LIMIT ? OFFSET ?
  `;
  queryParams.push(pageSize, offset);

  const list = db.prepare(listQuery).all(...queryParams);

  return { list, total, page, pageSize };
}

function getStatusText(status) {
  const statusMap = {
    'in_yard': '在场',
    'departed': '已出场',
    'locked': '已锁定',
  };
  return statusMap[status] || status;
}

function lockContainer(containerNo, reason) {
  const container = getContainer(containerNo);
  if (!container) {
    throw new Error(`箱号 ${containerNo} 不存在`);
  }
  if (container.status === 'departed') {
    throw new Error(`箱号 ${containerNo} 已出场，无法锁定`);
  }

  db.prepare(`
    UPDATE containers 
    SET status = 'locked', updated_at = datetime('now', 'localtime')
    WHERE container_no = ?
  `).run(containerNo);

  return getContainer(containerNo);
}

function unlockContainer(containerNo) {
  const container = getContainer(containerNo);
  if (!container) {
    throw new Error(`箱号 ${containerNo} 不存在`);
  }
  if (container.status !== 'locked') {
    throw new Error(`箱号 ${containerNo} 未被锁定`);
  }

  db.prepare(`
    UPDATE containers 
    SET status = 'in_yard', updated_at = datetime('now', 'localtime')
    WHERE container_no = ?
  `).run(containerNo);

  return getContainer(containerNo);
}

module.exports = {
  getContainer,
  containerArrival,
  containerDeparture,
  getContainerList,
  lockContainer,
  unlockContainer,
  getStatusText,
};
