// 验证 client.js 的 factory 能求值并返回插件（mock window.__ModuleLoader__ + React 桩）
import { readFileSync } from 'node:fs';

// 自带 React 桩：这里只跑 factory + apply，不渲染组件，
// 所以不依赖 ~/.dsh/profiles/node_modules 里是否装了 react。
const React = {
  createElement: (type, props, ...children) => ({ type, props: Object.assign({}, props || {}, { children }) }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};

const src = readFileSync(new URL('./client/client.js', import.meta.url), 'utf8');

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (spec) => {
      captured = spec;
    },
  },
};

// 模拟浏览器执行 client.js（它是 IIFE，直接读 window.__ModuleLoader__）
// eslint-disable-next-line no-eval
(0, eval)(src);

if (!captured) {
  console.log('FAIL: load() was not called');
  process.exit(1);
}
console.log('load id:', captured.id, '| factory type:', typeof captured.factory);

// 运行 factory，require("react") 用真实 React
const factoryRequire = (spec) => {
  if (spec === 'react') return React;
  throw new Error('unexpected require: ' + spec);
};
const moduleObj = captured.factory(factoryRequire);
console.log('factory exports:', Object.keys(moduleObj).join(','));
console.log('name:', moduleObj.name, '| inject:', JSON.stringify(moduleObj.inject), '| apply:', typeof moduleObj.apply);

// 用 mock ctx 跑 apply，验证注册逻辑不抛
const NS = 'abapMcp';
const slotRegistrations = [];
const remote = { $on: () => () => {} };
const ctx = {
  locale: {
    register: () => {},
    bind: () => (k) => k,
  },
  settingsScope: {
    bind: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ value: {} }), set: () => Promise.resolve() }),
  },
  // 可选服务统一走 ctx.get：remote 提供凭据通道，connection 只有旧版才带 api。
  get: (name) => (name === 'remote' ? remote : undefined),
  slots: {
    inject: (name, fn) => {
      if (name === 'settings.section') {
        // 触发注册，捕获 occupant 信息
        slotRegistrations.push(fn());
      }
    },
    register: (entry, component) => {
      slotRegistrations.push({ entry, componentType: typeof component });
      return entry;
    },
  },
  effect: (fn) => fn(),
};
moduleObj.apply(ctx);
console.log('slot registrations:', JSON.stringify(slotRegistrations));
console.log('apply OK — client plugin mounts without throwing');
process.exit(0);
