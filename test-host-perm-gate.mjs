// Host apply() 权限闸门集成验证（不 spawn、不连 SAP；连接路径属预期失败）：
//  1) 开启写权限但无 permConfirm → status.error 含"人工确认"，mode=read-only
//  2) 开启写权限 + 有效令牌 → 尝试连接（沙箱内 spawn 可能失败，但走的是连接分支而非闸门拒绝）
import { apply } from './lib/index.js';

const NS = 'abap-mcp';
const P = { sourceWrite: false, transports: false, refactor: false, exec: false, git: false, debug: false, serviceBinding: false };

let stored = {
  enabled: false, url: '', user: '', password: '', client: '000', language: 'EN',
  permissions: { ...P }, permConfirm: '', testRequest: 0, status: {},
};
const scope = {
  get: () => stored,
  update: (patch) => { stored = { ...stored, ...patch }; return Promise.resolve(); },
};

const registered = {};
const tools = { register: (def) => { registered[def.name] = def; return () => {}; } };
const listeners = {};
const ctx = {
  get: (n) => (n === 'settings' ? { register: () => scope } : undefined),
  on: (e, f) => { listeners[e] = f; return () => {}; },
  effect: (fn) => fn(),
  tools,
};

apply(ctx);
await new Promise((r) => setTimeout(r, 300));

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${extra ? '— ' + extra : ''}`); }
}

console.log('1) 开启写权限，但无 permConfirm → 拒绝生效');
stored = {
  ...stored, enabled: true, url: 'https://127.0.0.1:1/sap/bc/adt', user: 'u', password: 'p',
  permissions: { ...P, sourceWrite: true }, permConfirm: '',
};
listeners['settings/updated'](NS, {}, {}, 'update');
await new Promise((r) => setTimeout(r, 500));
assert('status.error 含"人工确认"', typeof stored.status.error === 'string' && stored.status.error.includes('人工确认'));
assert('mode 保持 read-only', stored.status.mode === 'read-only');
assert('未连接', stored.status.ok === false || stored.status.ok === undefined);

console.log('2) 开启写权限 + 有效令牌 → 走连接分支（非闸门拒绝）');
const now = Date.now();
const rand = Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, '0')).join('');
stored = {
  ...stored,
  permissions: { ...P, sourceWrite: true },
  permConfirm: `confirm-${now}-${rand}`,
};
listeners['settings/updated'](NS, {}, {}, 'update');
await new Promise((r) => setTimeout(r, 500));
assert('error 不再是"人工确认"（闸门放行，进入连接逻辑）', !(typeof stored.status.error === 'string' && stored.status.error.includes('人工确认')));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
