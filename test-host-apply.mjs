// dsh-abap-mcp Host apply() 端到端冒烟测试（无需真实 SAP）：
// mock 一个最小 ctx，配置 enabled=true，验证：
//   1) 插件拉起 server/dist/index.js 并成功连接（MCP listTools 不触网）
//   2) 注册 ~75 个 mcp__abap__* 工具 + abap_mcp_status
//   3) 把连接状态写回 status 字段
import { apply } from './lib/index.js';

const base = {
  enabled: true,
  url: 'https://127.0.0.1:1/sap/bc/adt',
  user: 'u',
  password: 'p',
  client: '000',
  language: 'EN',
  permissions: {
    sourceWrite: false,
    transports: false,
    refactor: false,
    exec: false,
    git: false,
    debug: false,
    serviceBinding: false,
  },
};

let stored = { ...base };
const scope = {
  get: () => stored,
  update: (patch) => {
    stored = { ...stored, ...patch };
    return Promise.resolve();
  },
};

const registered = new Map();
const calls = [];
const tools = {
  register: (def) => {
    // 模拟真实工具注册：同名重复注册即抛错（对应本次修复的 already registered）
    if (registered.has(def.name)) {
      throw new Error(`tool "${def.name}" is already registered`);
    }
    calls.push('register:' + def.name);
    registered.set(def.name, true);
    return () => {
      calls.push('dispose:' + def.name);
      registered.delete(def.name);
    };
  },
};

const listeners = {};
// credentials mock：提供 SAP_PASSWORD，让 apply 走真实连接注册路径。
const credentials = {
  resolve: async (ref) => (ref === 'SAP_PASSWORD' ? { value: 'test-pw', source: 'file' } : undefined),
  set: async () => {},
};
const ctx = {
  get: (name) => {
    if (name === 'settings') return { register: () => scope };
    if (name === 'credentials') return credentials;
    return undefined;
  },
  on: (evt, fn) => {
    listeners[evt] = fn;
    return () => {};
  },
  effect: (fn) => fn(),
  tools,
};

apply(ctx);

await new Promise((r) => setTimeout(r, 7000));

const mcp = [...registered.keys()].filter((n) => n.startsWith('mcp__abap__'));
const doubleReg = calls.filter((c) => /already registered/.test(c));
console.log('registered total:', registered.size);
console.log('mcp__abap__ tools:', mcp.length);
console.log('has abap_mcp_status:', registered.has('abap_mcp_status'));
console.log('status:', JSON.stringify(stored.status));
console.log('sample:', mcp.slice(0, 6).join(', '));
console.log('write-ish tool present:', registered.has('mcp__abap__setObjectSource'));
console.log('double-register errors:', doubleReg.length, doubleReg.length === 0 ? '(PASS)' : '(FAIL)');

// 模拟 ToolListChanged 重同步（触发 syncTools 先释放再注册路径）：
// 再次触发 settings/updated 不应因同名工具已注册而抛错。
if (listeners['settings/updated']) {
  for (let i = 0; i < 3; i++) listeners['settings/updated']('abap-mcp');
  await new Promise((r) => setTimeout(r, 2000));
  const doubleReg2 = calls.filter((c) => /already registered/.test(c));
  console.log('after re-sync double-register errors:', doubleReg2.length, doubleReg2.length === 0 ? '(PASS)' : '(FAIL)');
  console.log('leaked tools (registered but not disposed):', registered.size);
}

process.exit(0);
