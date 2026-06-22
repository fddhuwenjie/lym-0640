const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const exportsDir = path.join(__dirname, '..', 'exports');
if (!fs.existsSync(exportsDir)) {
  fs.mkdirSync(exportsDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'yard.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone TEXT NOT NULL,
      bay INTEGER NOT NULL,
      row INTEGER NOT NULL,
      tier INTEGER NOT NULL,
      slot_code TEXT UNIQUE NOT NULL,
      container_type TEXT NOT NULL,
      is_occupied INTEGER DEFAULT 0,
      is_sealed INTEGER DEFAULT 0,
      container_no TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS containers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_no TEXT UNIQUE NOT NULL,
      container_type TEXT NOT NULL,
      is_dangerous INTEGER DEFAULT 0,
      status TEXT DEFAULT 'in_yard',
      current_slot TEXT,
      departure_slot TEXT,
      arrival_time TEXT,
      estimated_departure_time TEXT,
      actual_departure_time TEXT,
      fee_status TEXT DEFAULT 'unpaid',
      total_fee REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      inspection_status TEXT DEFAULT 'pending',
      inspection_conclusion TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS move_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_no TEXT NOT NULL,
      from_slot TEXT,
      to_slot TEXT,
      move_type TEXT NOT NULL,
      operator TEXT,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS inspection_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_no TEXT NOT NULL,
      inspector TEXT,
      inspection_time TEXT,
      result TEXT NOT NULL,
      conclusion TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS fee_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_no TEXT NOT NULL,
      fee_type TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_time TEXT,
      payment_method TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS export_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      export_type TEXT NOT NULL,
      record_count INTEGER DEFAULT 0,
      exported_at TEXT DEFAULT (datetime('now', 'localtime')),
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS zone_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_type TEXT NOT NULL,
      is_dangerous INTEGER NOT NULL,
      zone TEXT NOT NULL,
      priority INTEGER NOT NULL,
      slot_container_type TEXT NOT NULL,
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(container_type, is_dangerous, zone, priority)
    );

    CREATE INDEX IF NOT EXISTS idx_containers_status ON containers(status);
    CREATE INDEX IF NOT EXISTS idx_containers_fee_status ON containers(fee_status);
    CREATE INDEX IF NOT EXISTS idx_slots_zone ON slots(zone);
    CREATE INDEX IF NOT EXISTS idx_move_records_container ON move_records(container_no);
    CREATE INDEX IF NOT EXISTS idx_fee_records_container ON fee_records(container_no);
  `);

  try {
    db.prepare('ALTER TABLE containers ADD COLUMN departure_slot TEXT').run();
  } catch (e) {}

  const slotCount = db.prepare('SELECT COUNT(*) as count FROM slots').get().count;
  if (slotCount === 0) {
    initSlots();
  }

  const configCount = db.prepare('SELECT COUNT(*) as count FROM zone_configs').get().count;
  if (configCount === 0) {
    initZoneConfigs();
  }
}

function initZoneConfigs() {
  const configs = [
    { container_type: '20GP',   is_dangerous: 0, zone: 'A', priority: 1, slot_container_type: '20GP', remark: '首选区' },

    { container_type: '40GP',   is_dangerous: 0, zone: 'B', priority: 1, slot_container_type: '40GP', remark: '首选区' },
    { container_type: '40GP',   is_dangerous: 0, zone: 'C', priority: 2, slot_container_type: '40HQ', remark: '备选区(40HQ兼容40GP)' },

    { container_type: '40HQ',   is_dangerous: 0, zone: 'C', priority: 1, slot_container_type: '40HQ', remark: '首选区' },
    { container_type: '40HQ',   is_dangerous: 0, zone: 'B', priority: 2, slot_container_type: '40GP', remark: '备选区(40GP兼容40HQ)' },

    { container_type: '20GP',   is_dangerous: 1, zone: 'D', priority: 1, slot_container_type: '20GP', remark: '危险品首选区' },

    { container_type: '40GP',   is_dangerous: 1, zone: 'E', priority: 1, slot_container_type: '40GP', remark: '危险品首选区' },
    { container_type: '40GP',   is_dangerous: 1, zone: 'D', priority: 2, slot_container_type: '20GP', remark: '危险品备选区(不允许-仅D为20GP,实际会被危险品校验过滤)' },

    { container_type: '40HQ',   is_dangerous: 1, zone: 'E', priority: 1, slot_container_type: '40GP', remark: '危险品首选区(E区40GP堆位兼容40HQ)' },
  ];

  const insertConfig = db.prepare(`
    INSERT INTO zone_configs 
      (container_type, is_dangerous, zone, priority, slot_container_type, remark)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const cfg of configs) {
      insertConfig.run(cfg.container_type, cfg.is_dangerous, cfg.zone, cfg.priority, cfg.slot_container_type, cfg.remark);
    }
  });

  transaction();
  console.log('堆区分配规则初始化完成');
}

function initSlots() {
  const zones = [
    { zone: 'A', container_type: '20GP', dangerous: false, bays: 10, rows: 6, tiers: 4 },
    { zone: 'B', container_type: '40GP', dangerous: false, bays: 8, rows: 6, tiers: 4 },
    { zone: 'C', container_type: '40HQ', dangerous: false, bays: 8, rows: 6, tiers: 3 },
    { zone: 'D', container_type: '20GP', dangerous: true, bays: 4, rows: 4, tiers: 3 },
    { zone: 'E', container_type: '40GP', dangerous: true, bays: 3, rows: 4, tiers: 3 },
  ];

  const insertSlot = db.prepare(`
    INSERT INTO slots (zone, bay, row, tier, slot_code, container_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const z of zones) {
      for (let bay = 1; bay <= z.bays; bay++) {
        for (let row = 1; row <= z.rows; row++) {
          for (let tier = 1; tier <= z.tiers; tier++) {
            const slotCode = `${z.zone}-${String(bay).padStart(2, '0')}-${String(row).padStart(2, '0')}-${tier}`;
            insertSlot.run(z.zone, bay, row, tier, slotCode, z.container_type);
          }
        }
      }
    }
  });

  transaction();
  console.log('堆位初始化完成');
}

module.exports = { db, initDatabase };
