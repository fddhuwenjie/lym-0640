#!/bin/bash
# 验收测试脚本

BASE="http://localhost:3000"
echo "============================"
echo "  港口堆场服务验收测试脚本"
echo "============================"
echo ""

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass_count=0
fail_count=0

assert_pass() {
  local name="$1"
  local actual="$2"
  local expect="$3"
  if echo "$actual" | grep -q "$expect"; then
    echo -e "${GREEN}[PASS]${NC} $name"
    ((pass_count++))
  else
    echo -e "${RED}[FAIL]${NC} $name"
    echo "       期望包含: $expect"
    echo "       实际内容: $actual"
    ((fail_count++))
  fi
}

echo "--- 1. 重复进场拒绝 ---"
r=$(curl -s -X POST $BASE/api/containers/arrival \
  -H "Content-Type: application/json" \
  -d '{"containerNo":"SEAL02","containerType":"40GP","operator":"test"}')
assert_pass "重复进场拒绝" "$r" "已在场内"
echo ""

echo "--- 2. 未查验出场拒绝 ---"
r=$(curl -s -X POST $BASE/api/containers/SEAL02/departure \
  -H "Content-Type: application/json" -d '{}')
assert_pass "未查验出场拒绝" "$r" "未完成查验"
echo ""

echo "--- 3. 先通过查验 ---"
r=$(curl -s -X POST $BASE/api/inspections \
  -H "Content-Type: application/json" \
  -d '{"containerNo":"SEAL02","result":"passed","conclusion":"ok","inspector":"t1"}')
assert_pass "查验通过" "$r" "\"result\":\"passed\""
echo ""

echo "--- 4. 欠费出场拒绝 ---"
r=$(curl -s -X POST $BASE/api/containers/SEAL02/departure \
  -H "Content-Type: application/json" -d '{}')
assert_pass "欠费出场拒绝" "$r" "未结清费用"
echo ""

echo "--- 5. 费用补缴 ---"
r=$(curl -s -X POST $BASE/api/fees/pay -H "Content-Type: application/json" \
  -d '{"containerNo":"SEAL02","amount":200,"paymentMethod":"cash","operator":"t1"}')
assert_pass "费用补缴成功" "$r" "\"feeStatus\":\"paid\""
echo ""

echo "--- 6. 补缴后出场成功 ---"
r=$(curl -s -X POST $BASE/api/containers/SEAL02/departure \
  -H "Content-Type: application/json" -d '{}')
assert_pass "补缴后出场成功" "$r" "\"success\":true"
echo ""

echo "--- 7. 查验异常锁定 ---"
# 先进场新箱
curl -s -X POST $BASE/api/containers/arrival \
  -H "Content-Type: application/json" \
  -d '{"containerNo":"LOCK01","containerType":"20GP","operator":"t1"}' > /dev/null
# 查验失败
r=$(curl -s -X POST $BASE/api/inspections \
  -H "Content-Type: application/json" \
  -d '{"containerNo":"LOCK01","result":"failed","conclusion":"违禁品","inspector":"t1"}')
assert_pass "查验失败自动锁定" "$r" "\"isLocked\":true"
# 锁定箱出场应拒绝
r=$(curl -s -X POST $BASE/api/containers/LOCK01/departure \
  -H "Content-Type: application/json" -d '{}')
assert_pass "锁定箱出场拒绝" "$r" "已被锁定"
echo ""

echo "--- 8. 出场清单保留出场前堆位 ---"
# 先查SEAL02的departure_slot
r=$(curl -s $BASE/api/containers/SEAL02)
slot=$(echo "$r" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'].get('departure_slot',''))")
if [ -n "$slot" ]; then
  echo -e "${GREEN}[PASS]${NC} departure_slot字段已保存: $slot"
  ((pass_count++))
else
  echo -e "${RED}[FAIL]${NC} departure_slot为空"
  echo "       响应内容: $r"
  ((fail_count++))
fi
# 导出出场清单
r=$(curl -s -X POST $BASE/api/exports/departure-list \
  -H "Content-Type: application/json" -d '{"createdBy":"test"}')
export_id=$(echo "$r" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'].get('exportId',0))")
assert_pass "出场清单导出成功" "$r" "\"success\":true"
echo "    导出ID: $export_id"
echo ""

echo "--- 9. 导出索引持久化(数据库查询) ---"
r=$(curl -s $BASE/api/exports?page=1\&pageSize=5)
count=$(echo "$r" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'].get('total',0))")
if [ "$count" -ge 1 ]; then
  echo -e "${GREEN}[PASS]${NC} 导出文件索引已保存, 共 $count 条记录"
  ((pass_count++))
else
  echo -e "${RED}[FAIL]${NC} 导出文件索引为空"
  ((fail_count++))
fi
echo ""

echo "--- 10. 危险品40HQ进入危险品区 ---"
r=$(curl -s -X POST $BASE/api/containers/arrival \
  -H "Content-Type: application/json" \
  -d '{"containerNo":"DHQ002","containerType":"40HQ","isDangerous":true,"operator":"t1"}')
assert_pass "危险品40HQ进场成功" "$r" "\"zone\":\"E\""
echo ""

echo "--- 11. 临时封区后分配到备选区 ---"
# 封B区和C区看看40GP是否给出明确错误或正确分配
# 先解封B区(之前已经封了)
curl -s -X POST $BASE/api/slots/zone/B/unseal -H "Content-Type: application/json" -d '{}' > /dev/null
# 现在封B和C
curl -s -X POST $BASE/api/slots/zone/B/seal -H "Content-Type: application/json" -d '{"reason":"m1"}' > /dev/null
curl -s -X POST $BASE/api/slots/zone/C/seal -H "Content-Type: application/json" -d '{"reason":"m2"}' > /dev/null
# 再进40GP 普通箱，应失败(B和C都封了)
r=$(curl -s -X POST $BASE/api/containers/arrival \
  -H "Content-Type: application/json" \
  -d '{"containerNo":"FALLBACK01","containerType":"40GP","operator":"t1"}')
assert_pass "所有备选区均封闭时给出明确错误" "$r" "所有可用堆区均已满或封闭"
# 解封C区
curl -s -X POST $BASE/api/slots/zone/C/unseal -H "Content-Type: application/json" -d '{}' > /dev/null
# 再进40GP，应进C区
r=$(curl -s -X POST $BASE/api/containers/arrival \
  -H "Content-Type: application/json" \
  -d '{"containerNo":"FALLBACK02","containerType":"40GP","operator":"t1"}')
assert_pass "首选区B封闭后分配到备选区C" "$r" "\"zone\":\"C\""
echo ""

echo "============================"
echo "  验收结果总结"
echo "============================"
echo -e "通过: ${GREEN}$pass_count${NC} 项"
echo -e "失败: ${RED}$fail_count${NC} 项"
echo ""

if [ $fail_count -eq 0 ]; then
  echo -e "${GREEN}全部验收通过！${NC}"
  exit 0
else
  echo -e "${RED}存在失败项，请检查！${NC}"
  exit 1
fi
