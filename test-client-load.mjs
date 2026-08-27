// 验证 client.js 的 factory 能求值并返回插件（mock window.__ModuleLoader__ + 真实 React）
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

// React 在共享依赖层（profiles/node_modules），从那里解析；
// 用系统用户主目录推导，避免硬编码本机用户名/路径。
const profilesRoot = join(homedir(), '.dsh', 'profiles', 'node_modules');
const sharedRequire = createRequire(join(profilesRoot, 'react', 'package.json'));
const React = sharedRequire('react');

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
const ctx = {
  locale: {
    register: () => {},
    bind: () => (k) => k,
  },
  settingsScope: {
    bind: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ value: {} }), set: () => Promise.resolve() }),
  },
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
