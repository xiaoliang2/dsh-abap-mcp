// 验证 client.js 的凭据读写接线：对着当前 DSH 的 ctx.remote.credentials 契约
// （Typert 远程命名空间：{ ok: true, value } / { ok: false, error }）跑真实路径
// 挂载读 → 输入密码 → 保存 → 清除。
//
// 自带 React 桩，所以不依赖 ~/.dsh/profiles/node_modules 里是否装了 react。
// 运行：node test-client-credentials.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./client/client.js', import.meta.url), 'utf8');

/** 捕获 __ModuleLoader__.load 的注册项。 */
let spec = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (registration) => {
      spec = registration;
    },
  },
};

// 浏览器里这是 IIFE，直接读 window.__ModuleLoader__。
(0, eval)(src);

function fail(message) {
  console.error('FAIL: ' + message);
  process.exit(1);
}

if (!spec) fail('__ModuleLoader__.load 未被调用');
if (spec.id !== '@xiaobanli/dsh-abap-mcp') fail('registration id 不对: ' + spec.id);

/** 够跑一个函数组件的 React 桩：真实 hooks 槽位 + 触发重渲染。 */
let hooks = [];
let cursor = 0;
let dirty = false;
const React = {
  createElement(type, props, ...children) {
    return {
      type,
      props: Object.assign({}, props || {}, {
        children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children,
      }),
    };
  },
  useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
    return [
      hooks[index],
      (next) => {
        hooks[index] = typeof next === 'function' ? next(hooks[index]) : next;
        dirty = true;
      },
    ];
  },
  useEffect(effect) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = effect() || null;
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = { current: initial };
    return hooks[index];
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot();
  },
};

const requireStub = (specifier) => {
  if (specifier === 'react') return React;
  throw new Error('unexpected require: ' + specifier);
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** 深度优先遍历 React 元素树。 */
function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node.props === undefined) return;
  visit(node);
  walk(node.props.children, visit);
}

/** 造一个 mock ctx；credentials 为空时模拟没有可用凭据通道的环境。 */
function makeCtx({ withRemote = true } = {}) {
  const calls = { describe: [], set: [], unset: [] };
  const credentials = {
    describe(refs) {
      calls.describe.push(refs);
      return Promise.resolve({ ok: true, value: { SAP_PASSWORD: { configured: true, writable: true } } });
    },
    set(ref, value) {
      calls.set.push([ref, value]);
      return Promise.resolve({ ok: true, value: undefined });
    },
    unset(ref) {
      calls.unset.push(ref);
      return Promise.resolve({ ok: true, value: undefined });
    },
  };
  const remote = withRemote
    ? { credentials, $on: () => () => {} }
    : { $on: () => () => {} };
  let render = null;
  const ctx = {
    locale: { register: () => () => {}, bind: () => (key) => key },
    settingsScope: {
      bind: () => ({
        subscribe: () => () => {},
        getSnapshot: () => ({ value: { enabled: true, url: 'http://sap:8000', user: 'DEV' } }),
        set: () => Promise.resolve(),
      }),
    },
    remote,
    get(name) {
      if (name === 'remote') return remote;
      if (name === 'connection') return undefined;
      return undefined;
    },
    slots: {
      inject(name, callback) {
        if (name === 'settings.section') callback();
      },
      register(_entry, component) {
        render = component;
        return () => {};
      },
    },
    effect(effect) {
      return effect();
    },
  };
  return { ctx, calls, getRender: () => render };
}

/** 挂载卡片并返回渲染树。 */
function renderCard(render, props) {
  cursor = 0;
  const element = render();
  const tree = element.type(Object.assign({}, props, element.props));
  return tree;
}

function findOne(tree, predicate, what) {
  let found = null;
  walk(tree, (node) => {
    if (found === null && predicate(node)) found = node;
  });
  if (found === null) fail('没找到 ' + what);
  return found;
}

// ---- 1) 当前契约：ctx.remote.credentials ----
{
  const { ctx, calls, getRender } = makeCtx();
  const plugin = spec.factory(requireStub);

  if (typeof plugin.apply !== 'function') fail('plugin.apply 不是函数');
  if (!Array.isArray(plugin.inject)) fail('plugin.inject 不是数组');
  if (plugin.inject.includes('connection')) fail('connection 不该再是硬依赖: ' + JSON.stringify(plugin.inject));
  if (!plugin.inject.includes('remote')) fail('remote 应在硬依赖里: ' + JSON.stringify(plugin.inject));

  plugin.apply(ctx);
  const render = getRender();
  if (typeof render !== 'function') fail('settings.section 没有注册渲染函数');

  let tree = renderCard(render);
  await flush();
  await flush();

  if (JSON.stringify(calls.describe[0]) !== JSON.stringify(['SAP_PASSWORD'])) {
    fail('describe 的实参形状不对（应为单参数数组）: ' + JSON.stringify(calls.describe));
  }

  // 读回 configured:true 后应出现「清除密码」按钮。
  tree = renderCard(render);
  findOne(tree, (n) => n.type === 'button' && n.props.children === 'card.password.clear', '清除密码按钮');

  // 输入密码 → 保存。
  const passwordInput = findOne(
    tree,
    (n) => n.type === 'input' && n.props.type === 'password',
    '密码输入框',
  );
  passwordInput.props.onChange({ target: { value: 's3cret' } });
  tree = renderCard(render);
  findOne(tree, (n) => n.type === 'button' && n.props.children === 'card.save', '保存按钮').props.onClick();
  await flush();
  await flush();

  if (JSON.stringify(calls.set) !== JSON.stringify([['SAP_PASSWORD', 's3cret']])) {
    fail('保存密码没有写到凭据库: ' + JSON.stringify(calls.set));
  }

  tree = renderCard(render);
  findOne(tree, (n) => n.type === 'button' && n.props.children === 'card.password.clear', '清除密码按钮').props.onClick();
  await flush();

  if (JSON.stringify(calls.unset) !== JSON.stringify(['SAP_PASSWORD'])) {
    fail('清除密码没有走到凭据库: ' + JSON.stringify(calls.unset));
  }

  console.log('OK  remote.credentials: describe/set/unset 接线正确');
}

// ---- 2) 没有凭据通道时：不崩、不误写 ----
{
  const { ctx, calls, getRender } = makeCtx({ withRemote: false });
  const plugin = spec.factory(requireStub);
  plugin.apply(ctx);
  const render = getRender();
  const tree = renderCard(render);
  await flush();
  findOne(tree, (n) => n.type === 'input' && n.props.type === 'password', '密码输入框');
  if (calls.describe.length + calls.set.length + calls.unset.length !== 0) {
    fail('无凭据通道时不该发出任何调用: ' + JSON.stringify(calls));
  }
  console.log('OK  无凭据通道: 卡片照常渲染，不发调用');
}

console.log('PASS');
