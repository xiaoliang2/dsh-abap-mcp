// 写前预览单测：computeLineDiff / writeApprovalReason（无需 SAP，纯逻辑）。
import { __writePreviewTest__ as T } from './lib/index.js';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('  ✗ FAIL:', msg);
  } else {
    console.log('  ✓ ok:', msg);
  }
}

console.log('== computeLineDiff ==');

// 1) 单处修改
{
  const d = T.computeLineDiff('REPORT a.\nWRITE x.\nWRITE y.\n', 'REPORT a.\nWRITE z.\nWRITE y.\n');
  assert(d.hunks.length === 1, `单处修改 → 1 hunk, got ${d.hunks.length}`);
  assert(d.add === 1 && d.del === 1, `+1/-1, got +${d.add}/-${d.del}`);
  const h = d.hunks[0];
  assert(h.oldStart === 2 && h.newStart === 2, `行号 旧L2→新L2, got 旧L${h.oldStart}→新L${h.newStart}`);
  const hasOld = h.lines.some((l) => l.t === 'old' && l.text === 'WRITE x.');
  const hasNew = h.lines.some((l) => l.t === 'new' && l.text === 'WRITE z.');
  assert(hasOld && hasNew, 'hunk 同时含 旧行(WRITE x.) 与 新行(WRITE z.)');
}

// 2) 无改动
{
  const d = T.computeLineDiff('a\nb\n', 'a\nb\n');
  assert(d.hunks.length === 0 && d.add === 0 && d.del === 0, '无改动 → 0 hunk, +0/-0');
}

// 3) 新增多行
{
  const d = T.computeLineDiff('a\n', 'a\nb\nc\nd\n');
  assert(d.add === 3 && d.del === 0, `尾部新增 3 行, got +${d.add}/-${d.del}`);
}

// 4) 全部删除
{
  const d = T.computeLineDiff('x\ny\nz\n', '');
  assert(d.del === 3 && d.add === 0, `全部删除 3 行, got -${d.del}/+${d.add}`);
}

// 5) 多 hunk
{
  const d = T.computeLineDiff('1\nA\n3\n4\nB\n6\n', '1\nX\n3\n4\nY\n6\n');
  assert(d.hunks.length === 2, `两处分离改动 → 2 hunks, got ${d.hunks.length}`);
}

// 6) 超大文本走退化路径（不崩即可）
{
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
  const d = T.computeLineDiff(big, big.replace('line 2500', 'line 2500-CHANGED'));
  assert(d.hunks.length >= 1, '5000 行大文本 diff 不崩且有改动');
}

console.log('== writeApprovalReason ==');

{
  const preview = {
    kind: 'edit',
    label: 'YTEST4',
    add: 1,
    del: 1,
    hunks: [{
      index: 1,
      oldStart: 35,
      newStart: 35,
      lines: [
        { t: 'old', text: 'DATA(lv_ratio) = lv_comp_len / lv_len_raw * 100.' },
        { t: 'new', text: 'DATA(lv_ratio) = CONV f( lv_comp_len ) / lv_len_raw * 100.' },
      ],
    }],
  };
  const reason = T.writeApprovalReason('setObjectSource', {}, preview);
  assert(reason.includes('YTEST4'), 'reason 含对象名');
  assert(reason.includes('+1/-1'), 'reason 含 +1/-1');
  assert(reason.includes('- DATA(lv_ratio)'), 'reason 含 旧行(-)');
  assert(reason.includes('+ DATA(lv_ratio)'), 'reason 含 新行(+)');
}

{
  const preview = { kind: 'create', label: 'YTEST5', lineCount: 3, source: 'REPORT ytest5.' };
  const reason = T.writeApprovalReason('createObject', {}, preview);
  assert(reason.includes('新建') && reason.includes('3 行'), '新建 reason 含 新建+行数');
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
