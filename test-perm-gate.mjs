// 写权限人工确认闸门验证（不 spawn、不连 SAP）：
//  1) 开启任意权限但无 permConfirm → permConfirmValid 拒绝（保持只读）
//  2) 开启任意权限 + 有效令牌（confirm-<epoch>-<rand>，epoch 距今 < 60s）→ 通过
//  3) 令牌过期（epoch 距今 > 60s）→ 拒绝
//  4) 全部关闭 → 无需确认（通过）
//  5) 覆盖全部 7 类权限：sourceWrite/transports/refactor/exec/git/debug/serviceBinding 一视同仁
// 直接复现 lib/index.js 里的 permConfirmValid 规则（与插件代码一致，保持同步维护）。
const PERM_CONFIRM_TTL_MS = 60_000;
const PERM_CONFIRM_PREFIX = 'confirm-';
function enabledPerms(cfg) {
  return Object.keys(cfg.permissions || {}).filter((k) => cfg.permissions[k] === true);
}
function permConfirmValid(cfg) {
  const on = enabledPerms(cfg);
  if (on.length === 0) return { ok: true };
  const token = typeof cfg.permConfirm === 'string' ? cfg.permConfirm : '';
  if (!token.startsWith(PERM_CONFIRM_PREFIX)) {
    return { ok: false, reason: `写权限（${on.join(',')}）需在设置卡片人工确认后方可生效` };
  }
  const rest = token.slice(PERM_CONFIRM_PREFIX.length);
  const dash = rest.indexOf('-');
  if (dash <= 0) return { ok: false, reason: '凭据格式错误' };
  const epoch = Number(rest.slice(0, dash));
  if (!Number.isFinite(epoch) || epoch <= 0) return { ok: false, reason: '凭据格式错误' };
  const age = Date.now() - epoch;
  if (age < 0 || age > PERM_CONFIRM_TTL_MS) return { ok: false, reason: '凭据已过期' };
  return { ok: true };
}

let pass = 0;
let fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${extra ? '— ' + extra : ''}`); }
}

const on = { sourceWrite: true, transports: false, refactor: false, exec: false, git: false, debug: false, serviceBinding: false };
const off = { sourceWrite: false, transports: false, refactor: false, exec: false, git: false, debug: false, serviceBinding: false };

const now = Date.now();
const fresh = `confirm-${now}-a1b2c3`;
const expired = `confirm-${now - 120000}-a1b2c3`;
const garbage = 'confirm-notatoken';
const future = `confirm-${now + 5000}-a1b2c3`;

console.log('1) 开启任意权限但无令牌 → 拒绝');
assert('无 permConfirm 拒绝', permConfirmValid({ permissions: on, permConfirm: '' }).ok === false);
assert('无 permConfirm 字段（undefined）拒绝', permConfirmValid({ permissions: on }).ok === false);

console.log('2) 开启 + 有效令牌 → 通过');
assert('新鲜令牌通过', permConfirmValid({ permissions: on, permConfirm: fresh }).ok === true);

console.log('3) 令牌过期/格式错/未来 → 拒绝');
assert('过期令牌拒绝', permConfirmValid({ permissions: on, permConfirm: expired }).ok === false);
assert('格式错拒绝', permConfirmValid({ permissions: on, permConfirm: garbage }).ok === false);
assert('未来令牌拒绝', permConfirmValid({ permissions: on, permConfirm: future }).ok === false);
assert('空串拒绝', permConfirmValid({ permissions: on, permConfirm: '' }).ok === false);

console.log('4) 全部关闭 → 无需确认');
assert('全关通过', permConfirmValid({ permissions: off, permConfirm: '' }).ok === true);
assert('全关且无 permConfirm 通过', permConfirmValid({ permissions: off }).ok === true);

console.log('5) 覆盖全部 7 类权限：任意一类开启无令牌都拒绝，带令牌都通过');
const KEYS = ['sourceWrite', 'transports', 'refactor', 'exec', 'git', 'debug', 'serviceBinding'];
const base = { sourceWrite: false, transports: false, refactor: false, exec: false, git: false, debug: false, serviceBinding: false };
for (const k of KEYS) {
  const one = { ...base, [k]: true };
  assert(`仅 ${k} 开启 + 无令牌 → 拒绝`, permConfirmValid({ permissions: one, permConfirm: '' }).ok === false);
  assert(`仅 ${k} 开启 + 新鲜令牌 → 通过`, permConfirmValid({ permissions: one, permConfirm: fresh }).ok === true);
}
assert('多权限同时开启 + 无令牌 → 拒绝', permConfirmValid({ permissions: { ...base, sourceWrite: true, transports: true, git: true }, permConfirm: '' }).ok === false);
assert('多权限同时开启 + 新鲜令牌 → 通过', permConfirmValid({ permissions: { ...base, sourceWrite: true, transports: true, git: true }, permConfirm: fresh }).ok === true);

console.log('6) 模拟卡片开启生成的令牌格式');
const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)))
  .map((b) => b.toString(16).padStart(2, '0')).join('');
const cardToken = `confirm-${Date.now()}-${rand}`;
assert('卡片令牌格式通过', permConfirmValid({ permissions: on, permConfirm: cardToken }).ok === true);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
