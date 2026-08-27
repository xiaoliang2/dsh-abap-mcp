// Host apply() 非 spawn 逻辑验证（沙箱内可跑，连接失败路径属预期）：
//  1) enabled=false → 状态"未启用"，只注册 abap_mcp_status
//  2) settings/updated(ns=abapMcp) 且 enabled=true → 触发连接（沙箱内 spawn 被拦 → 状态报错）
//  3) settings/updated(ns=其他) → 不触发
//  4) abap_mcp_status 输出不含密码
import { apply } from './lib/index.js';

const P = {
  sourceWrite: false,
  transports: false,
  refactor: false,
  exec: false,
  git: false,
  debug: false,
  serviceBinding: false,
};

let stored = { enabled: false, url: '', user: '', password: '', client: '000', language: 'EN', permissions: P };
const scope = {
  get: () => stored,
  update: (patch) => {
    stored = { ...stored, ...patch };
    return Promise.resolve();
  },
};

const registered = {};
const tools = {
  register: (def) => {
    registered[def.name] = def;
    return () => {};
  },
};
const listeners = {};
const ctx = {
  get: (n) => (n === 'settings' ? { register: () => scope } : undefined),
  on: (e, f) => {
    listeners[e] = f;
    return () => {};
  },
  effect: (fn) => fn(),
  tools,
};

apply(ctx);
await new Promise((r) => setTimeout(r, 400));

console.log('1) disabled status:', JSON.stringify(stored.status));
console.log('   registered:', Object.keys(registered).join(','));

const st = registered.abap_mcp_status;
console.log('   status tool exists:', !!st);
if (st) {
  const out = await st.execute({});
  console.log('   status tool output:', out.replace(/\n/g, ' | '));
  console.log('   leaks password:', out.includes('secret'));
}

stored = { ...stored, enabled: true, url: 'https://x', user: 'u', password: 'secret' };
listeners['settings/updated']('abapMcp', {}, {}, 'update');
await new Promise((r) => setTimeout(r, 900));
console.log('2) after enable via settings/updated, status:', JSON.stringify(stored.status));

const before = JSON.stringify(stored.status);
listeners['settings/updated']('other-ns', {}, {}, 'update');
await new Promise((r) => setTimeout(r, 400));
console.log('3) wrong-ns no-op:', JSON.stringify(stored.status) === before);

process.exit(0);
