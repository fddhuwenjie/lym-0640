# 港口集装箱堆场调度服务

## 项目用途

本系统是一个港口集装箱堆场调度管理服务，用于记录和管理集装箱从进场到出场的全生命周期，包括：

- **集装箱进场管理**：记录集装箱信息，根据箱型、危险品标记、预计离港时间和堆区容量自动分配堆位
- **堆位管理**：支持5个堆区（A、B、C普通区，D、E危险品区），支持临时封区/解封
- **移箱管理**：记录每次移箱操作，保留完整移箱历史
- **查验管理**：支持查验登记，查验异常自动锁定集装箱
- **出场管理**：出场前校验查验状态和费用状态，欠费或未查验禁止出场
- **费用管理**：自动计算滞港费，支持费用补缴
- **查询统计**：堆场占用查询、移箱历史查询、滞港费统计
- **数据导出**：出场清单CSV导出，保留导出文件索引

### 核心特性

- 数据持久化存储（SQLite数据库），重启后数据不丢失
- 完整的异常校验机制（堆位已满、危险品放普通区、未查验出场、重复进场、欠费放行）
- 支持临时封区后按可配置优先级规则重新分配堆位（多备选区机制）
- 查验异常箱自动锁定，费用补缴后可放行
- 出场清单保留**出场前堆位**（通过departure_slot字段持久化）
- 支持危险品 40HQ 进入危险品区（40尺箱型兼容规则）

---

## 堆位分配规则机制（zone_configs 可配置）

系统通过 `zone_configs` 表定义**按箱型+危险品属性的多优先级分配规则**，当首选区被封或堆满时，自动降级到后续备选区。

### 默认分配规则表

| 箱型  | 危险品 | 优先级 | 分配堆区 | 堆位物理箱型 | 说明 |
|-------|--------|--------|----------|--------------|------|
| 20GP  | 否     | 1      | A区      | 20GP         | 首选区 |
| 40GP  | 否     | 1      | B区      | 40GP         | 首选区 |
| 40GP  | 否     | 2      | C区      | 40HQ         | 备选区（40HQ堆位物理兼容40GP） |
| 40HQ  | 否     | 1      | C区      | 40HQ         | 首选区 |
| 40HQ  | 否     | 2      | B区      | 40GP         | 备选区（40GP堆位物理兼容40HQ） |
| 20GP  | 是     | 1      | D区      | 20GP         | 危险品首选区 |
| 40GP  | 是     | 1      | E区      | 40GP         | 危险品首选区 |
| **40HQ**  | **是**     | **1**      | **E区**      | **40GP**         | **危险品首选区（E区40GP堆位物理兼容40HQ）** |

### 箱型兼容规则（COMPATIBLE_MAP）

- **20GP**：仅可进入 `20GP` 堆位
- **40GP**：可进入 `40GP`、`40HQ` 堆位
- **40HQ**：可进入 `40HQ`、`40GP` 堆位

> 危险品区域规则始终**硬校验**：危险品只能在D/E区，普通箱只能在A/B/C区。

### 堆区分配规则管理接口

```
GET    /api/slots/config/rules                       # 查询所有规则（可按containerType/isDangerous过滤）
POST   /api/slots/config/rules                       # 新增分配规则
DELETE /api/slots/config/rules/:id                   # 删除分配规则
```

新增分配规则请求体：
```json
{
  "container_type": "40GP",
  "is_dangerous": 0,
  "zone": "C",
  "priority": 2,
  "slot_container_type": "40HQ",
  "remark": "临时溢出堆区"
}
```

---

## 出场前堆位保留机制

集装箱出场时，会将 `current_slot` 的值**同步保存到 `departure_slot` 字段**，然后清空 `current_slot`。

这样即使集装箱已出场，仍可通过 `departure_slot` 查询该箱**出场前的最后堆位**。

- 集装箱记录字段：`departure_slot TEXT`
- 出场清单CSV导出字段「堆位」：使用 `COALESCE(departure_slot, current_slot)`，出场箱优先取 departure_slot

---

## 技术栈

- **运行时**：Node.js
- **Web框架**：Express.js
- **数据库**：SQLite（better-sqlite3）
- **CSV导出**：csv-writer

---

## 启动方式

### 环境要求

- Node.js 16+
- npm 或 yarn

### 安装依赖

```bash
cd lym-0640
npm install
```

### 启动服务

```bash
npm start
```

服务默认运行在 `http://localhost:3000`

### 验证启动

访问健康检查接口：

```bash
curl http://localhost:3000/api/health
```

返回：
```json
{
  "success": true,
  "message": "港口集装箱堆场调度服务运行正常",
  "timestamp": "2026-06-22T04:37:26.281Z"
}
```

---

## 堆场配置

系统初始化时自动创建以下堆区：

| 堆区 | 类型       | 箱型   | 倍位 | 排 | 层 | 总堆位数 |
|------|------------|--------|------|----|----|----------|
| A区  | 普通区     | 20GP   | 10   | 6  | 4  | 240      |
| B区  | 普通区     | 40GP   | 8    | 6  | 4  | 192      |
| C区  | 普通区     | 40HQ   | 8    | 6  | 3  | 144      |
| D区  | 危险品区   | 20GP   | 4    | 4  | 3  | 48       |
| E区  | 危险品区   | 40GP/HQ| 3    | 4  | 3  | 36       |

堆位编码格式：`{区}-{倍位}-{排}-{层}`，例如：`A-01-03-2`

---

## API接口文档

### 1. 集装箱管理

#### 1.1 集装箱进场

```
POST /api/containers/arrival
Content-Type: application/json
```

请求体：
```json
{
  "containerNo": "CNTR001",
  "containerType": "20GP",
  "isDangerous": false,
  "estimatedDepartureTime": "2026-06-30 12:00:00",
  "operator": "admin"
}
```

参数说明：
- `containerNo`：箱号（必填）
- `containerType`：箱型，可选值 `20GP`、`40GP`、`40HQ`（必填）
- `isDangerous`：是否危险品，默认 `false`
- `estimatedDepartureTime`：预计离港时间
- `operator`：操作员

#### 1.2 集装箱出场

```
POST /api/containers/:containerNo/departure
Content-Type: application/json
```

请求体：
```json
{
  "operator": "admin"
}
```

#### 1.3 查询集装箱详情

```
GET /api/containers/:containerNo
```

#### 1.4 查询集装箱列表

```
GET /api/containers?status=in_yard&page=1&pageSize=20
```

查询参数：
- `status`：状态，可选值 `in_yard`（在场）、`departed`（已出场）、`locked`（已锁定）
- `feeStatus`：费用状态，可选值 `unpaid`、`partially_paid`、`paid`
- `inspectionStatus`：查验状态，可选值 `pending`、`passed`、`failed`
- `isDangerous`：是否危险品
- `containerType`：箱型
- `page`：页码，默认1
- `pageSize`：每页条数，默认20

#### 1.5 锁定/解锁集装箱

```
POST /api/containers/:containerNo/lock
POST /api/containers/:containerNo/unlock
```

### 2. 堆位管理

#### 2.1 堆场占用查询

```
GET /api/slots/occupancy
GET /api/slots/occupancy?zone=A
```

#### 2.2 堆位列表

```
GET /api/slots?zone=A&isOccupied=false&page=1&pageSize=20
```

#### 2.3 查询堆位详情

```
GET /api/slots/:slotCode
```

#### 2.4 封区/解封

```
POST /api/slots/zone/:zone/seal
POST /api/slots/zone/:zone/unseal
```

#### 2.5 封位/解位

```
POST /api/slots/:slotCode/seal
POST /api/slots/:slotCode/unseal
```

#### 2.6 可用堆位数量

```
GET /api/slots/available/count?containerType=20GP&isDangerous=false
```

### 3. 移箱管理

#### 3.1 移箱

```
POST /api/moves
Content-Type: application/json
```

请求体：
```json
{
  "containerNo": "CNTR001",
  "targetSlot": "A-02-01-1",
  "operator": "admin",
  "reason": "理货调整"
}
```

#### 3.2 移箱历史

```
GET /api/moves/history
GET /api/moves/history?containerNo=CNTR001&page=1&pageSize=20
```

#### 3.3 移箱统计

```
GET /api/moves/stats
GET /api/moves/stats?startDate=2026-06-01&endDate=2026-06-30
```

### 4. 查验管理

#### 4.1 查验登记

```
POST /api/inspections
Content-Type: application/json
```

请求体：
```json
{
  "containerNo": "CNTR001",
  "result": "passed",
  "conclusion": "货物正常，无异常",
  "inspector": "张工"
}
```

参数说明：
- `result`：查验结果，`passed`（通过）或 `failed`（未通过）
- 查验不通过时，集装箱自动被锁定

#### 4.2 查验历史

```
GET /api/inspections/history
GET /api/inspections/history?containerNo=CNTR001
```

#### 4.3 待查验列表

```
GET /api/inspections/pending
```

### 5. 费用管理

#### 5.1 计算滞港费

```
GET /api/fees/calculate/:containerNo
```

#### 5.2 费用补缴

```
POST /api/fees/pay
Content-Type: application/json
```

请求体：
```json
{
  "containerNo": "CNTR001",
  "amount": 200,
  "paymentMethod": "cash",
  "operator": "admin"
}
```

#### 5.3 费用记录

```
GET /api/fees/records
GET /api/fees/records?containerNo=CNTR001
```

#### 5.4 滞港费统计

```
GET /api/fees/stats
GET /api/fees/stats?startDate=2026-06-01&endDate=2026-06-30
```

#### 5.5 超期箱列表

```
GET /api/fees/overdue
```

### 6. 导出管理

#### 6.1 导出出场清单

```
POST /api/exports/departure-list
Content-Type: application/json
```

请求体：
```json
{
  "startDate": "2026-06-01",
  "endDate": "2026-06-30",
  "createdBy": "admin"
}
```

导出字段：箱号、堆位、箱型、危险品、费用状态、总费用、已付金额、查验状态、查验结论、出场时间

#### 6.2 导出堆场占用报表

```
POST /api/exports/yard-occupancy
```

#### 6.3 导出文件列表

```
GET /api/exports?page=1&pageSize=20
```

#### 6.4 导出文件详情

```
GET /api/exports/:id
```

---

## 验收路径

### 验收场景1：正常进场-查验-缴费-出场流程

**步骤：**

1. 集装箱进场
   ```bash
   curl -X POST http://localhost:3000/api/containers/arrival \
     -H "Content-Type: application/json" \
     -d '{"containerNo":"TEST001","containerType":"20GP","operator":"admin"}'
   ```
   **预期结果**：成功分配到A区堆位

2. 查验通过
   ```bash
   curl -X POST http://localhost:3000/api/inspections \
     -H "Content-Type: application/json" \
     -d '{"containerNo":"TEST001","result":"passed","conclusion":"正常","inspector":"张工"}'
   ```
   **预期结果**：查验状态更新为passed

3. 费用计算
   ```bash
   curl http://localhost:3000/api/fees/calculate/TEST001
   ```
   **预期结果**：显示费用明细（查验费200元 + 滞港费）

4. 未缴费出场（应拒绝）
   ```bash
   curl -X POST http://localhost:3000/api/containers/TEST001/departure
   ```
   **预期结果**：拒绝出场，提示欠费

5. 费用补缴
   ```bash
   curl -X POST http://localhost:3000/api/fees/pay \
     -H "Content-Type: application/json" \
     -d '{"containerNo":"TEST001","amount":200,"paymentMethod":"cash"}'
   ```
   **预期结果**：缴费成功，费用状态更新为paid

6. 出场放行
   ```bash
   curl -X POST http://localhost:3000/api/containers/TEST001/departure
   ```
   **预期结果**：出场成功

### 验收场景2：临时封区后重新分配堆位

**步骤：**

1. 进场多个40GP箱子（占用B区部分堆位）
2. 封闭B区
   ```bash
   curl -X POST http://localhost:3000/api/slots/zone/B/seal
   ```
3. 再进场40GP（应失败，因为B区已封且普通40GP只有B区）
   ```bash
   curl -X POST http://localhost:3000/api/containers/arrival \
     -H "Content-Type: application/json" \
     -d '{"containerNo":"SEALTEST","containerType":"40GP"}'
   ```
   **预期结果**：分配失败，提示B区已满/不可用

4. 解封B区
   ```bash
   curl -X POST http://localhost:3000/api/slots/zone/B/unseal
   ```
5. 再次进场40GP
   **预期结果**：成功分配堆位

### 验收场景3：查验异常箱锁定

**步骤：**

1. 集装箱进场
2. 查验不通过
   ```bash
   curl -X POST http://localhost:3000/api/inspections \
     -H "Content-Type: application/json" \
     -d '{"containerNo":"TEST002","result":"failed","conclusion":"发现违禁品","inspector":"李工"}'
   ```
   **预期结果**：集装箱状态变为locked

3. 尝试出场（应拒绝）
   ```bash
   curl -X POST http://localhost:3000/api/containers/TEST002/departure
   ```
   **预期结果**：拒绝出场，提示已锁定

4. 解锁集装箱
   ```bash
   curl -X POST http://localhost:3000/api/containers/TEST002/unlock
   ```
5. 重新查验通过
6. 缴费后出场

### 验收场景4：费用补缴后放行

**步骤：**

1. 集装箱进场并查验通过
2. 等待超期（或模拟），产生滞港费
3. 出场时因欠费被拒绝
4. 费用补缴
5. 再次出场，成功放行

### 验收场景5：异常场景校验

| 异常场景 | 触发方式 | 预期结果 |
|----------|----------|----------|
| 堆位已满 | 堆满某区后继续进场 | 拒绝进场，提示堆位已满 |
| 危险品放入普通区 | 危险品箱移至普通区堆位 | 拒绝移箱，提示危险品不能放入普通区 |
| 出场前未查验 | 未查验直接申请出场 | 拒绝出场，提示未完成查验 |
| 同一箱号重复进场 | 已在场箱号再次进场 | 拒绝进场，提示已在场内 |
| 欠费箱直接放行 | 未缴费申请出场 | 拒绝出场，提示未结清费用 |

### 验收场景6：数据持久化

**步骤：**

1. 进场若干集装箱，记录数据
2. 重启服务
   ```bash
   # 停止服务
   Ctrl+C
   # 重新启动
   npm start
   ```
3. 查询集装箱列表、移箱历史、费用记录
   **预期结果**：所有数据保持不变

4. 检查导出文件索引
   **预期结果**：导出记录和文件都存在

---

## 关键数据流转

### 1. 集装箱进场流程

```
进场申请
    ↓
校验箱号是否已在场 → 已在场 → 拒绝
    ↓ 未在场
根据箱型和危险品标记确定可用堆区
    ↓
查找空闲可用堆位 → 无可用堆位 → 拒绝（堆位已满）
    ↓ 找到堆位
分配堆位（占用标记+箱号关联）
    ↓
创建集装箱记录（状态：in_yard）
    ↓
记录移箱历史（进场类型）
    ↓
返回进场成功信息（箱号、堆位、进场时间）
```

### 2. 移箱流程

```
移箱申请
    ↓
校验集装箱是否在场 → 已出场/锁定 → 拒绝
    ↓
校验目标堆位是否存在 → 不存在 → 拒绝
    ↓
校验目标堆位是否被占用 → 已占用 → 拒绝
    ↓
校验目标堆位是否被封闭 → 已封闭 → 拒绝
    ↓
校验箱型是否匹配 → 不匹配 → 拒绝
    ↓
危险品校验：危险品箱不能放普通区，普通箱不能放危险品区
    ↓
释放原堆位
    ↓
占用新堆位
    ↓
更新集装箱当前堆位
    ↓
记录移箱历史
    ↓
返回移箱成功信息
```

### 3. 查验流程

```
查验登记
    ↓
校验集装箱状态 → 已出场 → 拒绝
    ↓
记录查验记录
    ↓
判断查验结果
    ├── passed → 更新查验状态为passed
    └── failed → 更新查验状态为failed，同时锁定集装箱（status=locked）
    ↓
更新集装箱查验结论
    ↓
返回查验结果
```

### 4. 出场流程

```
出场申请
    ↓
校验集装箱是否存在 → 不存在 → 拒绝
    ↓
校验是否已出场 → 已出场 → 拒绝
    ↓
校验是否被锁定 → 已锁定 → 拒绝
    ↓
校验查验状态 → 未通过/待查验 → 拒绝
    ↓
计算当前滞港费
    ↓
校验费用状态 → 未缴清 → 拒绝（提示欠费金额）
    ↓
释放堆位
    ↓
更新集装箱状态为departed
    ↓
记录出场时间
    ↓
记录移箱历史（出场类型）
    ↓
返回出场成功信息
```

### 5. 费用计算流程

```
费用计算
    ↓
获取集装箱信息
    ↓
计算在港天数 = 当前日期 - 进场日期
    ↓
判断是否超期：
    在港天数 ≤ 免费天数（3天）→ 滞港费 = 0
    在港天数 > 免费天数 → 计算超期费用
    ↓
超期费用计算：
    第4-7天：正常超期费率 × 天数
    第8天起：加重超期费率 × 天数
    ↓
总费用 = 滞港费 + 查验费（200元）
    ↓
更新集装箱总费用
    ↓
更新费用状态（unpaid/partially_paid/paid）
    ↓
返回费用明细
```

### 6. 数据持久化

所有数据存储在SQLite数据库文件 `data/yard.db` 中：

- **slots表**：堆位信息，包括占用状态、封闭状态
- **containers表**：集装箱信息，包括状态、费用、查验状态
- **move_records表**：移箱记录，完整追溯每次移动
- **inspection_records表**：查验记录
- **fee_records表**：缴费记录
- **export_files表**：导出文件索引

导出的CSV文件存储在 `exports/` 目录下，文件名包含导出类型和时间戳。

---

## 项目结构

```
lym-0640/
├── server.js                 # 服务入口
├── package.json              # 项目配置
├── data/                     # 数据库文件目录
│   └── yard.db              # SQLite数据库文件
├── exports/                  # 导出文件目录
│   └── *.csv                # 导出的CSV文件
└── src/
    ├── db.js                 # 数据库初始化
    ├── middleware/
    │   └── errorHandler.js   # 错误处理中间件
    ├── services/
    │   ├── slotService.js    # 堆位管理服务
    │   ├── containerService.js # 集装箱管理服务
    │   ├── moveService.js    # 移箱服务
    │   ├── inspectionService.js # 查验服务
    │   ├── feeService.js     # 费用服务
    │   └── exportService.js  # 导出服务
    └── routes/
        ├── slotRoutes.js     # 堆位路由
        ├── containerRoutes.js # 集装箱路由
        ├── moveRoutes.js     # 移箱路由
        ├── inspectionRoutes.js # 查验路由
        ├── feeRoutes.js      # 费用路由
        └── exportRoutes.js   # 导出路由
```

---

## 费率说明

### 免费堆存期

3天（72小时）

### 超期堆存费率

| 箱型   | 第4-7天（元/天） | 第8天起（元/天） |
|--------|------------------|------------------|
| 20GP   | 50               | 100              |
| 40GP   | 80               | 150              |
| 40HQ   | 100              | 180              |

### 查验费

统一 200元/箱
