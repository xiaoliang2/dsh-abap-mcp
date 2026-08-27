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

const registered = [];
const tools = {
  register: (def) => {
    registered.push(def.name);
    return () => {};
  },
};

const listeners = {};
const ctx = {
  get: (name) => (name === 'settings' ? { register: () => scope } : undefined),
  on: (evt, fn) => {
    listeners[evt] = fn;
    return () => {};
  },
  effect: (fn) => fn(),
  tools,
};

apply(ctx);

await new Promise((r) => setTimeout(r, 7000));

const mcp = registered.filter((n) => n.startsWith('mcp__abap__'));
console.log('registered total:', registered.length);
console.log('mcp__abap__ tools:', mcp.length);
console.log('has abap_mcp_status:', registered.includes('abap_mcp_status'));
console.log('status:', JSON.stringify(stored.status));
console.log('sample:', mcp.slice(0, 6).join(', '));
console.log('write-ish tool present:', registered.includes('mcp__abap__setObjectSource'));
process.exit(0);
