import { loadPermissions } from './dist/permissions.js';

const p = loadPermissions();
console.log('default -> readOnly:', p.isReadOnly(), '| tools:', p.enabledTools.size,
  '| login:', p.isEnabled('login'), '| getObjectSource:', p.isEnabled('getObjectSource'),
  '| setObjectSource:', p.isEnabled('setObjectSource'), '| pushRepo:', p.isEnabled('pushRepo'));

process.env.MCP_ABAP_PERMISSIONS = JSON.stringify({ git: true, debug: true });
const q = loadPermissions();
console.log('git+debug -> readOnly:', q.isReadOnly(), '| tools:', q.enabledTools.size,
  '| pushRepo:', q.isEnabled('pushRepo'), '| switchRepoBranch:', q.isEnabled('switchRepoBranch'),
  '| debuggerStep:', q.isEnabled('debuggerStep'), '| setObjectSource:', q.isEnabled('setObjectSource'),
  '| unknownTool:', q.isEnabled('bogus'), '| isKnown bogus:', q.isKnown('bogus'),
  '| isKnown healthcheck:', q.isKnown('healthcheck'));

process.env.MCP_ABAP_PERMISSIONS = 'not-json';
const r = loadPermissions();
console.log('bad-json -> readOnly:', r.isReadOnly(), '| tools:', r.enabledTools.size);
