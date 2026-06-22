const { db } = require('../db');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const exportsDir = path.join(__dirname, '..', '..', 'exports');

function generateFileName(type) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  return `${type}_${dateStr}_${timeStr}.csv`;
}

function exportDepartureList(params = {}) {
  const { startDate, endDate, createdBy = 'system' } = params;

  let whereClause = "WHERE status = 'departed'";
  let queryParams = [];

  if (startDate) {
    whereClause += ' AND actual_departure_time >= ?';
    queryParams.push(startDate + ' 00:00:00');
  }
  if (endDate) {
    whereClause += ' AND actual_departure_time <= ?';
    queryParams.push(endDate + ' 23:59:59');
  }

  const query = `
    SELECT 
      container_no as containerNo,
      COALESCE(departure_slot, current_slot) as slot,
      departure_slot as departureSlot,
      current_slot as currentSlot,
      fee_status as feeStatus,
      inspection_status as inspectionStatus,
      inspection_conclusion as inspectionConclusion,
      actual_departure_time as departureTime,
      total_fee as totalFee,
      paid_amount as paidAmount,
      container_type as containerType,
      is_dangerous as isDangerous
    FROM containers
    ${whereClause}
    ORDER BY actual_departure_time DESC
  `;

  const records = db.prepare(query).all(...queryParams);

  const fileName = generateFileName('departure_list');
  const filePath = path.join(exportsDir, fileName);

  const csvWriter = createCsvWriter({
    path: filePath,
    header: [
      { id: 'containerNo', title: '箱号' },
      { id: 'slot', title: '堆位' },
      { id: 'containerType', title: '箱型' },
      { id: 'isDangerous', title: '危险品' },
      { id: 'feeStatus', title: '费用状态' },
      { id: 'totalFee', title: '总费用' },
      { id: 'paidAmount', title: '已付金额' },
      { id: 'inspectionStatus', title: '查验状态' },
      { id: 'inspectionConclusion', title: '查验结论' },
      { id: 'departureTime', title: '出场时间' },
    ],
  });

  const formattedRecords = records.map(r => ({
    ...r,
    isDangerous: r.isDangerous ? '是' : '否',
    feeStatus: getFeeStatusText(r.feeStatus),
    inspectionStatus: getInspectionStatusText(r.inspectionStatus),
  }));

  return new Promise((resolve, reject) => {
    csvWriter.writeRecords(formattedRecords)
      .then(() => {
        db.prepare(`
          INSERT INTO export_files (file_name, file_path, export_type, record_count, created_by)
          VALUES (?, ?, 'departure_list', ?, ?)
        `).run(fileName, filePath, records.length, createdBy);

        const exportRecord = db.prepare(
          'SELECT * FROM export_files WHERE file_name = ?'
        ).get(fileName);

        resolve({
          fileName,
          filePath,
          recordCount: records.length,
          exportId: exportRecord.id,
          exportedAt: exportRecord.exported_at,
        });
      })
      .catch(reject);
  });
}

function getFeeStatusText(status) {
  const map = {
    'unpaid': '未缴',
    'partially_paid': '部分缴纳',
    'paid': '已缴清',
  };
  return map[status] || status;
}

function getInspectionStatusText(status) {
  const map = {
    'pending': '待查验',
    'passed': '查验通过',
    'failed': '查验未通过',
  };
  return map[status] || status;
}

function getExportList(page = 1, pageSize = 20) {
  const countQuery = 'SELECT COUNT(*) as total FROM export_files';
  const total = db.prepare(countQuery).get().total;

  const offset = (page - 1) * pageSize;
  const listQuery = `
    SELECT * FROM export_files
    ORDER BY exported_at DESC
    LIMIT ? OFFSET ?
  `;

  const list = db.prepare(listQuery).all(pageSize, offset);

  return { list, total, page, pageSize };
}

function getExportFile(exportId) {
  const record = db.prepare('SELECT * FROM export_files WHERE id = ?').get(exportId);

  if (!record) {
    throw new Error(`导出记录 ${exportId} 不存在`);
  }

  if (!fs.existsSync(record.file_path)) {
    throw new Error(`导出文件 ${record.file_name} 已不存在`);
  }

  return {
    ...record,
    fileContent: fs.readFileSync(record.file_path, 'utf-8'),
  };
}

function exportYardOccupancy(createdBy = 'system') {
  const query = `
    SELECT 
      s.zone,
      s.container_type,
      COUNT(*) as total_slots,
      SUM(CASE WHEN s.is_occupied = 1 THEN 1 ELSE 0 END) as occupied_slots,
      SUM(CASE WHEN s.is_sealed = 1 THEN 1 ELSE 0 END) as sealed_slots,
      ROUND(SUM(CASE WHEN s.is_occupied = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as occupancy_rate
    FROM slots s
    GROUP BY s.zone, s.container_type
    ORDER BY s.zone ASC
  `;

  const records = db.prepare(query).all();

  const fileName = generateFileName('yard_occupancy');
  const filePath = path.join(exportsDir, fileName);

  const csvWriter = createCsvWriter({
    path: filePath,
    header: [
      { id: 'zone', title: '堆区' },
      { id: 'container_type', title: '箱型' },
      { id: 'total_slots', title: '总堆位数' },
      { id: 'occupied_slots', title: '已占用' },
      { id: 'sealed_slots', title: '已封闭' },
      { id: 'occupancy_rate', title: '占用率(%)' },
    ],
  });

  return new Promise((resolve, reject) => {
    csvWriter.writeRecords(records)
      .then(() => {
        db.prepare(`
          INSERT INTO export_files (file_name, file_path, export_type, record_count, created_by)
          VALUES (?, ?, 'yard_occupancy', ?, ?)
        `).run(fileName, filePath, records.length, createdBy);

        resolve({
          fileName,
          filePath,
          recordCount: records.length,
        });
      })
      .catch(reject);
  });
}

module.exports = {
  exportDepartureList,
  getExportList,
  getExportFile,
  exportYardOccupancy,
};
