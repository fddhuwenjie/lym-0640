const { db } = require('../db');

const DANGEROUS_ZONES = ['D', 'E'];
const NORMAL_ZONES = ['A', 'B', 'C'];

const COMPATIBLE_MAP = {
  '20GP': ['20GP'],
  '40GP': ['40GP', '40HQ'],
  '40HQ': ['40HQ', '40GP'],
};

function getZoneAllocationRules(containerType, isDangerous) {
  return db.prepare(`
    SELECT zone, priority, slot_container_type, remark
    FROM zone_configs
    WHERE container_type = ? AND is_dangerous = ?
    ORDER BY priority ASC
  `).all(containerType, isDangerous ? 1 : 0);
}

function getCompatibleSlotTypes(containerType) {
  return COMPATIBLE_MAP[containerType] || [containerType];
}

function isSlotCompatible(slotContainerType, containerType) {
  const compatible = getCompatibleSlotTypes(containerType);
  return compatible.includes(slotContainerType);
}

function allocateSlot(containerType, isDangerous, estimatedDepartureTime) {
  const rules = getZoneAllocationRules(containerType, isDangerous);

  if (!rules || rules.length === 0) {
    throw new Error(`未配置 ${containerType}${isDangerous ? '(危险品)' : ''} 的堆区分配规则`);
  }

  let lastError = null;
  const triedZones = [];

  for (const rule of rules) {
    triedZones.push(`${rule.zone}(${rule.slot_container_type},p${rule.priority})`);

    const slotContainerTypes = [rule.slot_container_type];
    const compatibleTypes = getCompatibleSlotTypes(containerType);
    const placeholders = slotContainerTypes.map(() => '?').join(',');

    const query = `
      SELECT slot_code, zone, bay, row, tier, container_type
      FROM slots
      WHERE zone = ?
        AND container_type IN (${placeholders})
        AND is_occupied = 0
        AND is_sealed = 0
      ORDER BY 
        CASE 
          WHEN ? IS NOT NULL THEN ABS(strftime('%s', ?) - strftime('%s', 'now'))
          ELSE 0
        END DESC,
        bay ASC,
        row ASC,
        tier ASC
      LIMIT 1
    `;

    const params = [rule.zone, ...slotContainerTypes, estimatedDepartureTime, estimatedDepartureTime];
    const slot = db.prepare(query).get(...params);

    if (slot) {
      return { ...slot, rule_remark: rule.remark };
    }
  }

  const zoneDesc = rules.map(r => `${r.zone}区(${r.remark})`).join(' → ');
  throw new Error(`${containerType}${isDangerous ? '(危险品)' : ''} 所有可用堆区均已满或封闭，分配路径: ${zoneDesc}`);
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
  if (!slotCode) return false;
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

function getZoneType(zone) {
  const info = db.prepare(`
    SELECT DISTINCT container_type as slot_type, zone
    FROM slots WHERE zone = ? LIMIT 1
  `).get(zone);
  if (!info) return null;
  return DANGEROUS_ZONES.includes(zone) ? 'dangerous' : 'normal';
}

function validateMoveTarget(container, targetSlotInfo) {
  const targetZone = targetSlotInfo.zone;

  if (container.is_dangerous && NORMAL_ZONES.includes(targetZone)) {
    return { valid: false, reason: `危险品集装箱不能放入普通区 ${targetZone} 区` };
  }

  if (!container.is_dangerous && DANGEROUS_ZONES.includes(targetZone)) {
    return { valid: false, reason: `普通集装箱不能放入危险品区 ${targetZone} 区` };
  }

  if (!isSlotCompatible(targetSlotInfo.container_type, container.container_type)) {
    return {
      valid: false,
      reason: `目标堆位 ${targetSlotInfo.slot_code} 为 ${targetSlotInfo.container_type} 箱型，` +
              `与集装箱箱型 ${container.container_type} 不兼容`
    };
  }

  return { valid: true };
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

  return { sealedCount: result.changes, zone, reason: reason || '未说明' };
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
  const rules = getZoneAllocationRules(containerType, isDangerous);
  if (!rules || rules.length === 0) return 0;

  let total = 0;
  for (const rule of rules) {
    const slotContainerTypes = [rule.slot_container_type];
    const placeholders = slotContainerTypes.map(() => '?').join(',');
    const query = `
      SELECT COUNT(*) as count
      FROM slots
      WHERE zone = ?
        AND container_type IN (${placeholders})
        AND is_occupied = 0
        AND is_sealed = 0
    `;
    const r = db.prepare(query).get(rule.zone, ...slotContainerTypes);
    total += r.count;
  }
  return total;
}

function getZoneConfigList(containerType, isDangerous) {
  let where = [];
  let params = [];
  if (containerType) {
    where.push('container_type = ?');
    params.push(containerType);
  }
  if (isDangerous !== undefined) {
    where.push('is_dangerous = ?');
    params.push(isDangerous ? 1 : 0);
  }
  let whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`
    SELECT * FROM zone_configs ${whereSql}
    ORDER BY container_type, is_dangerous, priority
  `).all(...params);
}

function addZoneConfig(config) {
  const { container_type, is_dangerous, zone, priority, slot_container_type, remark } = config;
  const info = db.prepare(`
    INSERT INTO zone_configs (container_type, is_dangerous, zone, priority, slot_container_type, remark)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(container_type, is_dangerous ? 1 : 0, zone, priority, slot_container_type, remark || '');
  return info.lastInsertRowid;
}

function deleteZoneConfig(id) {
  return db.prepare('DELETE FROM zone_configs WHERE id = ?').run(id).changes > 0;
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
  validateMoveTarget,
  getZoneAllocationRules,
  getZoneConfigList,
  addZoneConfig,
  deleteZoneConfig,
  DANGEROUS_ZONES,
  NORMAL_ZONES,
};
