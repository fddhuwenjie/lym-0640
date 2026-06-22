const express = require('express');
const cors = require('cors');
const { initDatabase } = require('./src/db');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');

const containerRoutes = require('./src/routes/containerRoutes');
const slotRoutes = require('./src/routes/slotRoutes');
const moveRoutes = require('./src/routes/moveRoutes');
const inspectionRoutes = require('./src/routes/inspectionRoutes');
const feeRoutes = require('./src/routes/feeRoutes');
const exportRoutes = require('./src/routes/exportRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

initDatabase();

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: '港口集装箱堆场调度服务运行正常',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/containers', containerRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/moves', moveRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api/fees', feeRoutes);
app.use('/api/exports', exportRoutes);

app.get('/', (req, res) => {
  res.json({
    name: '港口集装箱堆场调度服务',
    version: '1.0.0',
    description: '记录集装箱进场、堆位分配、移箱、查验、出场和费用状态',
    endpoints: {
      health: 'GET /api/health',
      containers: {
        list: 'GET /api/containers',
        detail: 'GET /api/containers/:containerNo',
        arrival: 'POST /api/containers/arrival',
        departure: 'POST /api/containers/:containerNo/departure',
        lock: 'POST /api/containers/:containerNo/lock',
        unlock: 'POST /api/containers/:containerNo/unlock',
      },
      slots: {
        list: 'GET /api/slots',
        detail: 'GET /api/slots/:slotCode',
        occupancy: 'GET /api/slots/occupancy',
        sealZone: 'POST /api/slots/zone/:zone/seal',
        unsealZone: 'POST /api/slots/zone/:zone/unseal',
        sealSlot: 'POST /api/slots/:slotCode/seal',
        unsealSlot: 'POST /api/slots/:slotCode/unseal',
      },
      moves: {
        move: 'POST /api/moves',
        history: 'GET /api/moves/history',
        stats: 'GET /api/moves/stats',
      },
      inspections: {
        inspect: 'POST /api/inspections',
        history: 'GET /api/inspections/history',
        stats: 'GET /api/inspections/stats',
        pending: 'GET /api/inspections/pending',
      },
      fees: {
        calculate: 'GET /api/fees/calculate/:containerNo',
        pay: 'POST /api/fees/pay',
        records: 'GET /api/fees/records',
        stats: 'GET /api/fees/stats',
        overdue: 'GET /api/fees/overdue',
      },
      exports: {
        list: 'GET /api/exports',
        departureList: 'POST /api/exports/departure-list',
        yardOccupancy: 'POST /api/exports/yard-occupancy',
        detail: 'GET /api/exports/:id',
      },
    },
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`  港口集装箱堆场调度服务已启动`);
  console.log(`  服务地址: http://localhost:${PORT}`);
  console.log(`  API地址:  http://localhost:${PORT}/api`);
  console.log(`========================================`);
});

module.exports = app;
