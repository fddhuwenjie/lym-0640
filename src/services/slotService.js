const { db } = require('../db');

const DANGEROUS_ZONES = ['D', 'E'];
const NORMAL_ZONES = ['A', 'B', 'C'];

function getZonesByType(isDangerous, containerType) {
  if (isDangerous) {
    const zones = [];
    if (containerType === '20GP') zones.push('D');
    if (containerType === '40GP' || containerType === '40HQ') zones.push('E');
    return zones;
  } else {
    const zones = [];
    if (containerType === '20GP') zones.push('A');
    if (containerType === '40GP') zones.push('B');
    if (containerType === '40HQ') zones.push('C');
    return zones;
  }
}

function allocateSlot(containerType, isDangerous, estimatedDepartureTime) {
  const zones = getZonesByType(isDangerous, containerType);

  if (zones.length === 0) {
    throw new Error(`不支持的箱型: ${containerType}${isDangerous ? '(危险品)' : ''}`);
  }

  const placeholders = zones.map(() => '?').join(',');

  const query = `
    SELECT slot_code, zone, bay, row, tier
    FROM slots
    WHERE zone IN (${placeholders})
      AND container_type = ?
      AND is_occupied = 0
      AND is_sealed = 0
    ORDER BY 
      CASE 
        WHEN ? IS NOT NULL THEN ABS(strftime('%s', ?) - strftime('%s', 'now'))
        ELSE 0
      END DESC,
      zone ASC,
      bay ASC,
      row ASC,
      tier ASC
    LIMIT 1
  `;

  const params = [...zones, containerType, estimatedDepartureTime, estimatedDepartureTime];
  const slot = db.prepare(query).get(...params);

  if (!slot) {
    const zoneNames = zones.join('、');
    throw new Error(`${zoneNames}区${container_type_full_name(containerType)}堆位已满，无法分配`);
  }

  return slot;
}

function container_type_full_name(type) {
  const names = { '20GP': '20尺普通箱', '40GP': '40尺普通箱', '40HQ': '40尺高箱' };
  return names[type] || type;
}

function occupySlot(slotCode, containerNo) {
  const result = db.prepare(`
    UPDATE slots 
    SET is_occupied = 1, container_no = ?, updated_at = datetime('now', 'localtime')
    WHERE slot_code = ? AND is_occupied = 0 AND is_sealed = 0
  `).run(containerNo, slotCode);

  if (result.changes === 0) {
    throw new Error(`堆位 ${slotCode} 不可用`);
  }

  return true;
}

function releaseSlot(slotCode) {
  const result = db.prepare(`
    UPDATE slots 
    SET is_occupied = 0, container_no = NULL, updated_at = datetime('now', 'localtime')
    WHERE slot_code = ?
  `).run(slotCode);

  return result.changes > 0;
}

function getSlotInfo(slotCode) {
  return db.prepare('SELECT * FROM slots WHERE slot_code = ?').get(slotCode);
}

function getYardOccupancy(zone) {
  let query = `
    SELECT 
      zone,
      container_type,
      COUNT(*) as total_slots,
      SUM(CASE WHEN is_occupied = 1 THEN 1 ELSE 0 END) as occupied_slots,
      SUM(CASE WHEN is_sealed = 1 THEN 1 ELSE 0 END) as sealed_slots,
      ROUND(SUM(CASE WHEN is_occupied = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as occupancy_rate
    FROM slots
  `;

  const params = [];
  if (zone) {
    query += ' WHERE zone = ?';
    params.push(zone);
  }

  query += ' GROUP BY zone, container_type ORDER BY zone ASC';

  return db.prepare(query).all(...params);
}

function getSlotList(params = {}) {
  const { zone, isOccupied, isSealed, containerType, page = 1, pageSize = 20 } = params;

  let whereClause = [];
  let queryParams = [];

  if (zone) {
    whereClause.push('zone = ?');
    queryParams.push(zone);
  }
  if (isOccupied !== undefined) {
    whereClause.push('is_occupied = ?');
    queryParams.push(isOccupied ? 1 : 0);
  }
  if (isSealed !== undefined) {
    whereClause.push('is_sealed = ?');
    queryParams.push(isSealed ? 1 : 0);
  }
  if (containerType) {
    whereClause.push('container_type = ?');
    queryParams.push(containerType);
  }

  let whereSql = '';
  if (whereClause.length > 0) {
    whereSql = ' WHERE ' + whereClause.join(' AND ');
  }

  const countQuery = `SELECT COUNT(*) as total FROM slots${whereSql}`;
  const total = db.prepare(countQuery).get(...queryParams).total;

  const offset = (page - 1) * pageSize;
  const listQuery = `
    SELECT * FROM slots${whereSql}
    ORDER BY zone ASC, bay ASC, row ASC, tier ASC
    LIMIT ? OFFSET ?
  `;
  queryParams.push(pageSize, offset);

  const list = db.prepare(listQuery).all(...queryParams);

  return { list, total, page, pageSize };
}

function sealZone(zone, reason) {
  const result = db.prepare(`
    UPDATE slots 
    SET is_sealed = 1, updated_at = datetime('now', 'localtime')
    WHERE zone = ? AND is_occupied = 0
  `).run(zone);

  return { sealedCount: result.changes, zone };
}

function unsealZone(zone) {
  const result = db.prepare(`
    UPDATE slots 
    SET is_sealed = 0, updated_at = datetime('now', 'localtime')
    WHERE zone = ?
  `).run(zone);

  return { unsealedCount: result.changes, zone };
}

function sealSlot(slotCode, reason) {
  const slot = getSlotInfo(slotCode);
  if (!slot) {
    throw new Error(`堆位 ${slotCode} 不存在`);
  }
  if (slot.is_occupied) {
    throw new Error(`堆位 ${slotCode} 已被占用，无法封位`);
  }

  db.prepare(`
    UPDATE slots 
    SET is_sealed = 1, updated_at = datetime('now', 'localtime')
    WHERE slot_code = ?
  `).run(slotCode);

  return getSlotInfo(slotCode);
}

function unsealSlot(slotCode) {
  const result = db.prepare(`
    UPDATE slots 
    SET is_sealed = 0, updated_at = datetime('now', 'localtime')
    WHERE slot_code = ?
  `).run(slotCode);

  if (result.changes === 0) {
    throw new Error(`堆位 ${slotCode} 不存在`);
  }

  return getSlotInfo(slotCode);
}

function getAvailableSlotCount(containerType, isDangerous) {
  const zones = getZonesByType(isDangerous, containerType);

  if (zones.length === 0) {
    return 0;
  }

  const placeholders = zones.map(() => '?').join(',');

  const query = `
    SELECT COUNT(*) as count
    FROM slots
    WHERE zone IN (${placeholders})
      AND container_type = ?
      AND is_occupied = 0
      AND is_sealed = 0
  `;

  const result = db.prepare(query).get(...zones, containerType);
  return result.count;
}

module.exports = {
  allocateSlot,
  occupySlot,
  releaseSlot,
  getSlotInfo,
  getYardOccupancy,
  getSlotList,
  sealZone,
  unsealZone,
  sealSlot,
  unsealSlot,
  getAvailableSlotCount,
  getZonesByType,
};
