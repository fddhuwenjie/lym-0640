#!/usr/bin/env python3
"""服务重启后数据持久化验证脚本"""
import urllib.request
import json
import subprocess
import os
import time

BASE = "http://localhost:3000"

def api_get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.loads(r.read())

def check(name, cond, detail=""):
    if cond:
        print(f"  ✅ {name}")
        return True
    else:
        print(f"  ❌ {name} {detail}")
        return False

results = []
print("=== 服务重启后持久化验证 ===")
print()

# 1. 导出文件索引
try:
    data = api_get("/api/exports")
    total = data["data"]["total"]
    ok = check("导出文件索引存在", total >= 1, f"实际: {total} 条")
    results.append(("导出索引持久化", ok))
    if data["data"]["list"]:
        first = data["data"]["list"][0]
        print(f"     -> ID={first['id']}, 文件={first['file_name']}, 记录数={first['record_count']}")
except Exception as e:
    print(f"  ❌ 导出索引查询失败: {e}")
    results.append(("导出索引持久化", False))

# 2. 出场箱 departure_slot (用SEAL02验证, 该箱在验收脚本中已完整出场)
try:
    d = api_get("/api/containers/SEAL02")["data"]
    slot = d.get("departure_slot")
    status = d["status"]
    ok = check(
        "SEAL02出场堆位保留(departure_slot)",
        slot is not None and status == "departed",
        f"departure_slot={slot}, status={status}"
    )
    print(f"     -> departure_slot={slot}, 出场时间={d['actual_departure_time']}")
    results.append(("出场堆位保留", ok))
except Exception as e:
    print(f"  ❌ SEAL02查询失败: {e}")
    results.append(("出场堆位保留", False))

# 3. 危险品40HQ
try:
    d = api_get("/api/containers/DHQ001")["data"]
    zone = d["current_slot"].split("-")[0] if d["current_slot"] else None
    ok = check(
        "DHQ001危险品40HQ在危险品区",
        d["is_dangerous"] == 1 and zone == "E" and d["container_type"] == "40HQ",
        f"zone={zone}, dangerous={d['is_dangerous']}"
    )
    print(f"     -> 当前堆位={d['current_slot']}")
    results.append(("危险品40HQ", ok))
except Exception as e:
    print(f"  ❌ DHQ001查询失败: {e}")
    results.append(("危险品40HQ", False))

# 4. 查验异常锁定箱
try:
    d = api_get("/api/containers/LOCK01")["data"]
    ok = check(
        "LOCK01锁定并查验失败",
        d["status"] == "locked" and d["inspection_status"] == "failed",
        f"status={d['status']}, inspection={d['inspection_status']}"
    )
    results.append(("查验异常锁定", ok))
except Exception as e:
    print(f"  ❌ LOCK01查询失败: {e}")
    results.append(("查验异常锁定", False))

# 5. 导出的CSV文件
print()
files = [f for f in os.listdir("exports") if f.endswith(".csv")] if os.path.isdir("exports") else []
ok = check("CSV导出文件存在", len(files) >= 1, f"实际: {len(files)} 个")
results.append(("CSV文件存在", ok))
if files:
    print(f"     -> 文件列表: {', '.join(files)}")
    for fn in sorted(files)[:1]:
        path = os.path.join("exports", fn)
        with open(path) as f:
            lines = f.readlines()
        print(f"     -> {fn} 内容:")
        for line in lines[:5]:
            print(f"        {line.rstrip()}")

# 6. 移箱记录
print()
try:
    d = api_get("/api/moves/history?containerNo=SEAL02")["data"]
    ok = check("SEAL02移箱历史记录存在", d["total"] >= 2, f"实际: {d['total']} 条")
    for m in d["list"]:
        print(f"     类型={m['move_type']}, 从={m['from_slot']}, 到={m['to_slot']}")
    results.append(("移箱历史持久化", ok))
except Exception as e:
    print(f"  ❌ 移箱历史查询失败: {e}")
    results.append(("移箱历史持久化", False))

# 7. 费用记录
print()
try:
    d = api_get("/api/fees/records?containerNo=SEAL02")["data"]
    ok = check("SEAL02缴费记录存在", d["total"] >= 1, f"实际: {d['total']} 条")
    if d["list"]:
        print(f"     -> 金额={d['list'][0]['amount']}, 方式={d['list'][0]['payment_method']}")
    results.append(("费用记录持久化", ok))
except Exception as e:
    print(f"  ❌ 费用记录查询失败: {e}")
    results.append(("费用记录持久化", False))

print()
print("=" * 50)
print("  持久化验证总结")
print("=" * 50)
passed = sum(1 for _, ok in results if ok)
total = len(results)
for name, ok in results:
    print(f"  {'✅' if ok else '❌'} {name}")
print()
print(f"  结果: {passed}/{total} 项通过")
if passed == total:
    print("  🎉 全部持久化验证通过！")
