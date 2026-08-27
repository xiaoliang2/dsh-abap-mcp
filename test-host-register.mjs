// 验证 Host apply() 启动路径：tools.register 契约（output.schema/render）+ settings 注册
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];

// 复刻 dsh-tools 的 assertSupportedJsonSchema（只覆盖本包 schema 用到的子集，但严格校验）
function checkNode(node, path, violations) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    violations.push(`${path} must be an object schema`);
    return;
  }
  const allowed = new Set([
    'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
    'description', 'title', 'examples', 'default', 'deprecated', 'readOnly', 'writeOnly',
  ]);
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) violations.push(`${path}.${key} is not a supported keyword`);
  }
  const hasType = Object.hasOwn(node, 'type');
  const hasOneOf = Object.hasOwn(node, 'oneOf');
  if (hasType && hasOneOf) { violations.push(`${path} cannot declare both type and oneOf`); return; }
  if (!hasType && !hasOneOf) return; // annotation-only form
  if (hasOneOf) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) violations.push(`${path}.oneOf must be an array of >= 2 schemas`);
    else node.oneOf.forEach((s, i) => checkNode(s, `${path}.oneOf[${i}]`, violations));
    return;
  }
  const type = node.type;
  if (typeof type !== 'string' || !SCHEMA_TYPES.includes(type)) {
    violations.push(`${path}.type must be one of ${SCHEMA_TYPES.join('/')}`);
    return;
  }
  for (const [key, types] of Object.entries({
    properties: ['object'], required: ['object'], additionalProperties: ['object'],
    items: ['array'], enum: ['string', 'number', 'integer', 'boolean', 'null'], const: ['string', 'number', 'integer', 'boolean', 'null'],
  })) {
    if (Object.hasOwn(node, key) && !types.includes(type)) violations.push(`${path}.${key} not supported on type "${type}"`);
  }
  if (type === 'object' && Object.hasOwn(node, 'properties')) {
    for (const [name, sub] of Object.entries(node.properties)) checkNode(sub, `${path}.properties.${name}`, violations);
  }
  if (type === 'array' && Object.hasOwn(node, 'items')) checkNode(node.items, `${path}.items`, violations);
}

const captured = [];
const violations = [];
const scope = { get: () => ({}), update: (patch) => { capturedStatus = patch; return Promise.resolve(); } };
let capturedStatus = null;
const ctx = {
  get: (name) => (name === 'settings' ? { register: () => scope } : undefined),
  on: () => () => {},
  effect: (fn) => { fn(); return () => {}; },
  tools: {
    register(def) {
      const out = def.output;
      if (!out || typeof out !== 'object' || typeof out.render !== 'function') throw new TypeError(`tool "${def.name}" must declare output { schema, render, presentationMeta? }`);
      checkNode(out.schema, `tool "${def.name}" output.schema`, violations);
      captured.push({ name: def.name, schema: out.schema });
      return () => {};
    },
  },
};

const mod = await import(new URL('./lib/index.js', import.meta.url));
console.log('plugin name:', mod.name, '| inject:', JSON.stringify(mod.inject));

mod.apply(ctx);

if (violations.length) {
  console.log('SCHEMA VIOLATIONS:');
  for (const v of violations) console.log('  - ' + v);
  process.exit(1);
}
console.log('registered tools:', captured.map((t) => t.name).join(', ') || '(none)');
console.log('status published on startup:', JSON.stringify(capturedStatus));
console.log('PASS — apply() startup path works, all tools declare valid output');
process.exit(0);
