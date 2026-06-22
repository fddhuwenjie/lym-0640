const { db } = require('../db');

function getContainer(containerNo) {
  return db.prepare('SELECT * FROM containers WHERE container_no = ?').get(containerNo);
}

const STORAGE_FEE_RATES = {
  '20GP': { normal: 50, overtime: 100 },
  '40GP': { normal: 80, overtime: 150 },
  '40HQ': { normal: 100, overtime: 180 },
};

const FREE_DAYS = 3;
const INSPECTION_FEE = 200;

function calculateStorageFee(containerNo) {
  const container = getContainer(containerNo);
  if (!container) {
    throw new Error(`箱号 ${containerNo} 不存在`);
  }

  if (container.status === 'departed') {
    return { totalFee: container.total_fee, paidAmount: container.paid_amount };
  }

  const arrivalTime = new Date(container.arrival_time);
  const now = new Date();
  const diffTime = Math.abs(now - arrivalTime);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  const rate = STORAGE_FEE_RATES[container.container_type];
  let storageFee = 0;

  if (diffDays > FREE_DAYS) {
    const normalDays = Math.min(diffDays - FREE_DAYS, 4);
    const overtimeDays = Math.max(0, diffDays - FREE_DAYS - 4);
    storageFee = normalDays * rate.normal + overtimeDays * rate.overtime;
  }

  const totalFee = storageFee + INSPECTION_FEE;

  db.prepare(`
    UPDATE containers 
    SET total_fee = ?, updated_at = datetime('now', 'localtime')
    WHERE container_no = ?
  `).run(totalFee, containerNo);

  updateFeeStatus(containerNo);

  return {
    containerNo,
    totalDays: diffDays,
    freeDays: FREE_DAYS,
    storageFee,
    inspectionFee: INSPECTION_FEE,
    totalFee,
    paidAmount: container.paid_amount,
    unpaidAmount: totalFee - container.paid_amount,
  };
}

function updateFeeStatus(containerNo) {
  const container = getContainer(containerNo);
  let feeStatus = 'unpaid';

  if (container.paid_amount >= container.total_fee && container.total_fee > 0) {
    feeStatus = 'paid';
  } else if (container.paid_amount > 0) {
    feeStatus = 'partially_paid';
  }

  db.prepare(`
    UPDATE containers SET fee_status = ? WHERE container_no = ?
  `).run(feeStatus, containerNo);

  return feeStatus;
}

function payFee(containerNo, amount, paymentMethod, operator) {
  const container = getContainer(containerNo);
  if (!container) {
    throw new Error(`箱号 ${containerNo} 不存在`);
  }

  if (container.status === 'departed') {
    throw new Error(`箱号 ${containerNo} 已出场，无法缴费`);
  }

  if (amount <= 0) {
    throw new Error('缴费金额必须大于0');
  }

  calculateStorageFee(containerNo);
  const updatedContainer = getContainer(containerNo);

  const unpaidAmount = updatedContainer.total_fee - updatedContainer.paid_amount;
  if (amount > unpaidAmount + 0.01) {
    throw new Error(`缴费金额 ${amount} 超过未缴金额 ${unpaidAmount.toFixed(2)} 元`);
  }

  const transaction = db.transaction(() => {
    const newPaidAmount = updatedContainer.paid_amount + amount;

    db.prepare(`
      UPDATE containers 
      SET paid_amount = ?, updated_at = datetime('now', 'localtime')
      WHERE container_no = ?
    `).run(newPaidAmount, containerNo);

    db.prepare(`
      INSERT INTO fee_records 
        (container_no, fee_type, amount, payment_time, payment_method)
      VALUES (?, 'storage_fee', ?, datetime('now', 'localtime'), ?)
    `).run(containerNo, amount, paymentMethod || 'cash');

    updateFeeStatus(containerNo);
  });

  transaction();

  const finalContainer = getContainer(containerNo);

  return {
    containerNo,
    paidAmount: amount,
    totalPaid: finalContainer.paid_amount,
    totalFee: finalContainer.total_fee,
    feeStatus: finalContainer.fee_status,
    remainingUnpaid: (finalContainer.total_fee - finalContainer.paid_amount).toFixed(2),
  };
}

function getFeeRecords(containerNo, page = 1, pageSize = 20) {
  let whereClause = '';
  let queryParams = [];

  if (containerNo) {
    whereClause = 'WHERE container_no = ?';
    queryParams.push(containerNo);
  }

  const countQuery = `SELECT COUNT(*) as total FROM fee_records ${whereClause}`;
  const total = db.prepare(countQuery).get(...queryParams).total;

  const offset = (page - 1) * pageSize;
  const listQuery = `
    SELECT * FROM fee_records ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  queryParams.push(pageSize, offset);

  const list = db.prepare(listQuery).all(...queryParams);

  return { list, total, page, pageSize };
}

function getStorageFeeStats(startDate, endDate) {
  const start = startDate || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  const query = `
    SELECT 
      c.container_type,
      COUNT(DISTINCT c.container_no) as container_count,
      SUM(
        CASE 
          WHEN julianday('now') - julianday(c.arrival_time) > ${FREE_DAYS}
          THEN (julianday('now') - julianday(c.arrival_time) - ${FREE_DAYS}) 
               * CASE c.container_type
                   WHEN '20GP' THEN 50
                   WHEN '40GP' THEN 80
                   WHEN '40HQ' THEN 100
                   ELSE 50
                 END
          ELSE 0
        END
      ) as estimated_storage_fee,
      SUM(c.total_fee) as total_fee,
      SUM(c.paid_amount) as total_paid,
      SUM(c.total_fee - c.paid_amount) as total_unpaid
    FROM containers c
    WHERE c.status IN ('in_yard', 'locked')
      AND c.arrival_time BETWEEN ? AND ?
    GROUP BY c.container_type
    ORDER BY total_fee DESC
  `;

  return db.prepare(query).all(start + ' 00:00:00', end + ' 23:59:59');
}

function getOverdueContainers(page = 1, pageSize = 20) {
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM containers 
    WHERE status IN ('in_yard', 'locked')
      AND julianday('now') - julianday(arrival_time) > ?
  `;
  const total = db.prepare(countQuery).get(FREE_DAYS).total;

  const offset = (page - 1) * pageSize;
  const listQuery = `
    SELECT 
      c.*,
      CAST(julianday('now') - julianday(c.arrival_time) AS INTEGER) as days_in_yard,
      (c.total_fee - c.paid_amount) as unpaid_amount
    FROM containers c
    WHERE status IN ('in_yard', 'locked')
      AND julianday('now') - julianday(c.arrival_time) > ?
    ORDER BY days_in_yard DESC
    LIMIT ? OFFSET ?
  `;

  const list = db.prepare(listQuery).all(FREE_DAYS, pageSize, offset);

  return { list, total, page, pageSize };
}

module.exports = {
  calculateStorageFee,
  payFee,
  getFeeRecords,
  getStorageFeeStats,
  getOverdueContainers,
  FREE_DAYS,
  STORAGE_FEE_RATES,
  INSPECTION_FEE,
};
