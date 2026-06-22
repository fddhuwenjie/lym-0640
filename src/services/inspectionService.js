const { db } = require('../db');
const containerService = require('./containerService');

function inspectContainer(data) {
  const { containerNo, result, conclusion, inspector } = data;

  if (!containerNo || !result) {
    throw new Error('箱号和查验结果不能为空');
  }

  const validResults = ['passed', 'failed'];
  if (!validResults.includes(result)) {
    throw new Error(`无效的查验结果: ${result}，有效值: passed、failed`);
  }

  const container = containerService.getContainer(containerNo);
  if (!container) {
    throw new Error(`箱号 ${containerNo} 不存在`);
  }

  if (container.status === 'departed') {
    throw new Error(`箱号 ${containerNo} 已出场，无法查验`);
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO inspection_records 
        (container_no, inspector, inspection_time, result, conclusion)
      VALUES (?, ?, datetime('now', 'localtime'), ?, ?)
    `).run(containerNo, inspector || 'system', result, conclusion || '');

    let newStatus = container.status;
    if (result === 'failed' && container.status !== 'locked') {
      newStatus = 'locked';
    }

    db.prepare(`
      UPDATE containers 
      SET inspection_status = ?,
          inspection_conclusion = ?,
          status = ?,
          updated_at = datetime('now', 'localtime')
      WHERE container_no = ?
    `).run(result, conclusion || '', newStatus, containerNo);
  });

  transaction();

  const updatedContainer = containerService.getContainer(containerNo);

  return {
    containerNo,
    result,
    conclusion: conclusion || '',
    inspectionTime: new Date().toLocaleString('zh-CN'),
    isLocked: result === 'failed',
    container: updatedContainer,
  };
}

function getInspectionHistory(containerNo, page = 1, pageSize = 20) {
  let whereClause = '';
  let queryParams = [];

  if (containerNo) {
    whereClause = 'WHERE container_no = ?';
    queryParams.push(containerNo);
  }

  const countQuery = `SELECT COUNT(*) as total FROM inspection_records ${whereClause}`;
  const total = db.prepare(countQuery).get(...queryParams).total;

  const offset = (page - 1) * pageSize;
  const listQuery = `
    SELECT * FROM inspection_records ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  queryParams.push(pageSize, offset);

  const list = db.prepare(listQuery).all(...queryParams);

  return { list, total, page, pageSize };
}

function getInspectionStats(startDate, endDate) {
  let whereClause = '';
  let params = [];

  if (startDate && endDate) {
    whereClause = 'WHERE created_at BETWEEN ? AND ?';
    params.push(startDate, endDate);
  }

  const query = `
    SELECT 
      result,
      COUNT(*) as count
    FROM inspection_records
    ${whereClause}
    GROUP BY result
    ORDER BY count DESC
  `;

  return db.prepare(query).all(...params);
}

function getPendingInspectionContainers(page = 1, pageSize = 20) {
  return containerService.getContainerList({
    inspectionStatus: 'pending',
    status: 'in_yard',
    page,
    pageSize,
  });
}

module.exports = {
  inspectContainer,
  getInspectionHistory,
  getInspectionStats,
  getPendingInspectionContainers,
};
