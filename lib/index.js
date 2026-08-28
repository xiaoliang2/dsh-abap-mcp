// dsh-abap-mcp — Host 半（Node ESM，宿主进程内运行）
//
// 职责：把 SAP ABAP ADT 的 MCP 服务器拉起、连接、并把它的工具注册为
// mcp__abap__<tool>。权限模型在服务器侧强制（MCP_ABAP_PERMISSIONS，默认只读），
// 这里只负责：
//   - 注册/读取 settings 命名空间 abap-mcp（连接配置 + 7 类权限开关 + 状态）
//   - 用配置 spawn `node server/dist/index.js` 并连接（StdioClientTransport）
//   - 配置变更（settings/updated）→ 重连；连接意外断开 → 有界退避重试
//   - 把运行状态写回 status 字段（Client 卡片展示），并提供 abap_mcp_status 工具
//
// 依赖均来自宿主运行时的共享依赖层（peerDependencies 声明，不打包）。

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-abap-mcp";

export const inject = ["tools", "settings"];

const NS = "abap-mcp";
const SERVER_NAME = "abap";
const TOOL_CALL_TIMEOUT_MS = 60000;
// SAP 密码在 DSH 凭据库中的引用名（credentialRef：POSIX 环境变量名）。
// 与子进程环境变量同名；若启动环境里已设置 SAP_PASSWORD 会优先（凭据库条目被只读遮蔽，与 DEEPSEEK_API_KEY 同款行为）。
const PASSWORD_REF = "SAP_PASSWORD";

// 连接意外断开时的重试上限与退避（秒）。
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;

// ---------------- settings 命名空间 schema ----------------
const PermissionsSchema = z
  .object({
    sourceWrite: z.boolean().default(false),
    transports: z.boolean().default(false),
    refactor: z.boolean().default(false),
    exec: z.boolean().default(false),
    git: z.boolean().default(false),
    debug: z.boolean().default(false),
    serviceBinding: z.boolean().default(false),
  })
  .default({});

const StatusSchema = z
  .object({
    ok: z.boolean().default(false),
    error: z.string().default(""),
    mode: z.string().default("read-only"),
    tools: z.number().default(0),
    connectedAt: z.number().default(0),
    // 「测试连接」进行中标记 + 最近一次测试结果（Host 写回，Client 展示）。
    testing: z.boolean().default(false),
    lastTest: z
      .object({
        ok: z.boolean().default(false),
        at: z.number().default(0),
        latencyMs: z.number().default(0),
        tools: z.number().default(0),
        error: z.string().default(""),
      })
      .default({}),
  })
  .default({});

const ConfigSchema = z
  .object({
    // 总开关：关闭时不连接、不注册任何工具。
    enabled: z.boolean().default(false),
    // 连接配置（可经由设置卡片随时修改，改动即重连）。
    url: z.string().default(""),
    user: z.string().default(""),
    // 密码不写入 settings.yaml：保存在 DSH 凭据库（$DSH_HOME/.credentials.yaml，ref: SAP_PASSWORD）。
    // 此字段仅作历史迁移/回退用（role secret：任何时刻都不跨线暴露）；Host 首次读到非空时迁移并清空。
    password: z.string().role("secret").default(""),
    client: z.string().default("000"),
    language: z.string().default("EN"),
    // 7 类权限开关，默认全关 = 严格只读。真正生效点在服务器侧。
    permissions: PermissionsSchema,
    // 权限人工确认凭据：设置卡片开启任意权限时生成 `confirm-<epoch>-<rand>` 一并写入，
    // Host 在 60 秒内且值非空时才允许以可写模式连接（防 AI 自行开启任意权限）。
    // 该字段不参与重连判定、不进服务器环境、也不出现在 abap_mcp_status 中。
    permConfirm: z.string().default(""),
    // 写操作逐次人工确认总开关（默认 true）：开启时每个写工具执行前都会弹 DSH 原生
    // 审批卡，用户确认后才写入；关闭后写工具在权限已开时直接执行（不推荐）。
    // 只影响 Host 审批闸门，不参与重连判定、不进服务器环境。
    writeConfirm: z.boolean().default(true),
    // 「测试连接」请求：Client 点按钮时写入当前时间戳；Host 响应当前配置执行一次真实连接测试。
    testRequest: z.number().default(0),
    // Host 写回的运行状态（Client 卡片读取；不参与重连判定）。
    status: StatusSchema,
  })
  .default({});

// 服务器 dist 入口（本插件包内）。
function serverEntry() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "server", "dist", "index.js");
}

function publicToolName(rawName) {
  return `mcp__${SERVER_NAME}__${rawName}`;
}

// ---------------- 权限人工确认闸门（模块顶层，供 buildChildEnv / apply 共用） ----------------
// 只有当「开启的任意权限」同时携带「有效的 permConfirm」时，才允许以可写模式连接。
// 有效凭据 = `confirm-<epoch>-<rand>`，epoch 需在最近 60 秒内。
// 目的：AI 只能通过 settings API 改 permissions，却无法在 60 秒窗口内猜中卡片生成的随机串，
// 从而把「开启任意权限」收口为只有用户手动在设置卡片操作才能完成。
const PERM_CONFIRM_TTL_MS = 60_000;
const PERM_CONFIRM_PREFIX = "confirm-";

function enabledPerms(cfg) {
  return Object.keys(cfg.permissions || {}).filter((k) => cfg.permissions[k] === true);
}

function permConfirmValid(cfg) {
  const on = enabledPerms(cfg);
  if (on.length === 0) return { ok: true }; // 无任何权限开启，无需确认
  const token = typeof cfg.permConfirm === "string" ? cfg.permConfirm : "";
  if (!token.startsWith(PERM_CONFIRM_PREFIX)) {
    return { ok: false, reason: `权限（${on.join(",")}）需在设置卡片人工确认后方可生效` };
  }
  const rest = token.slice(PERM_CONFIRM_PREFIX.length);
  const dash = rest.indexOf("-");
  if (dash <= 0) {
    return { ok: false, reason: "权限确认凭据格式错误，请在设置卡片重新操作" };
  }
  const epoch = Number(rest.slice(0, dash));
  if (!Number.isFinite(epoch) || epoch <= 0) {
    return { ok: false, reason: "权限确认凭据格式错误，请在设置卡片重新操作" };
  }
  const age = Date.now() - epoch;
  if (age < 0 || age > PERM_CONFIRM_TTL_MS) {
    return { ok: false, reason: "权限确认凭据已过期，请重新在设置卡片开启" };
  }
  return { ok: true };
}


// ---------------- 写操作人工确认 ----------------
// 写工具的权威名单来自 server/src/permissions.ts（单一事实源）：Host 直接加载
// server 的编译产物，避免在两端各维护一份工具表导致漂移。加载失败时降级为
// 「所有工具都不做写确认」并告警（只读工具本就无副作用，写工具仍需开启权限）。
const SERVER_PERMS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
  "dist",
  "permissions.js"
);

// toolName -> permissionCategory（7 类写分类之一）；只包含真实写工具。
let WRITE_CATEGORY_BY_TOOL = null;
function loadWriteCategories() {
  if (WRITE_CATEGORY_BY_TOOL !== null) return WRITE_CATEGORY_BY_TOOL;
  const map = new Map();
  try {
    const req = createRequire(import.meta.url);
    const perms = req(SERVER_PERMS_PATH);
    const cats = perms && perms.CATEGORY_TOOLS;
    if (cats && typeof cats === "object") {
      for (const cat of Object.keys(cats)) {
        const tools = cats[cat];
        if (!tools || typeof tools.forEach !== "function") continue;
        tools.forEach((name) => {
          if (!map.has(name)) map.set(name, cat);
        });
      }
    }
  } catch (e) {
    console.error("[dsh-abap-mcp] failed to load write-category table from server:", String(e));
  }
  WRITE_CATEGORY_BY_TOOL = map;
  return map;
}

// 把调用参数整理成给用户看的人类可读摘要（用于审批 reason）。
// 源码/内容类字段展示实际前若干字符（含换行），让用户能看到「将写入什么」；
// 其余参数取关键字段并截断长值，绝不含密码。
function summarizeWriteArgs(args) {
  if (!args || typeof args !== "object") return "（无参数）";
  const pieces = [];
  const KEY_ORDER = ["name", "url", "objectName", "type", "adtcore:name", "adtcore:uri", "transport", "request", "lockHandle"];
  const seen = new Set();
  for (const key of KEY_ORDER) {
    if (!(key in args) || seen.has(key)) continue;
    seen.add(key);
    const v = args[key];
    if (v === undefined || v === null || v === "") continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    pieces.push(`${key}=${s.length > 80 ? s.slice(0, 80) + `…(${s.length})` : s}`);
  }
  // 源码/内容类字段：展示实际内容前 300 字符（含换行），并标注总长/行数。
  for (const key of ["source", "content", "code", "snippet", "data", "text"]) {
    if (!(key in args) || seen.has(key)) continue;
    seen.add(key);
    const v = args[key];
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    const lines = s.split("\n").length;
    const preview = s.length > 300 ? s.slice(0, 300) + `…` : s;
    pieces.push(`${key}=[${s.length}字符/${lines}行] ${preview.replace(/\n/g, "␤")}`);
  }
  // 其余标量参数（数量、布尔、简短字符串）。
  for (const key of Object.keys(args)) {
    if (seen.has(key)) continue;
    const v = args[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      if (v.length > 0 && v.length <= 60) pieces.push(`${key}=${v}`);
      else if (v.length > 60) pieces.push(`${key}=${v.length}字符`);
    } else if (typeof v === "number" || typeof v === "boolean") {
      pieces.push(`${key}=${v}`);
    }
  }
  return pieces.length > 0 ? pieces.join("; ") : "（无参数）";
}

// 对一个写工具调用发起人工确认。只有 DSH 原生审批给出 'allowed-once' 才继续执行；
// 否则（拒绝/取消/无审批通道）抛错，调用方应把错误作为 isError 返回，绝不写入。
// exec 来自工具执行的第二个参数（{ agent, callId, signal }）。
async function requireWriteApproval(ctx, rawToolName, args, exec) {
  const approval = ctx.get("approval");
  if (approval === undefined || typeof approval.request !== "function") {
    throw new Error(
      `写操作 ${rawToolName} 需要人工确认，但当前环境没有 approval 审批通道，已拒绝执行。`
    );
  }
  const agent = exec && exec.agent;
  if (agent === undefined) {
    throw new Error(
      `写操作 ${rawToolName} 需要人工确认，但本次调用没有关联的 Agent 会话，已拒绝执行。`
    );
  }
  const summary = summarizeWriteArgs(args);
  const outcome = await approval.request({
    agent,
    toolName: publicToolName(rawToolName),
    ...(exec && exec.callId ? { callId: exec.callId } : {}),
    reason: `写操作确认：${publicToolName(rawToolName)} 将向 SAP 写入数据。\n参数：${summary}\n\n确认后才会真正执行写入；拒绝则本次不做任何修改。`,
    ...(exec && exec.signal ? { signal: exec.signal } : {}),
  });
  if (outcome === "allowed-once") return;
  const why =
    outcome === "rejected"
      ? "被用户拒绝"
      : outcome === "cancelled"
        ? "审批被取消"
        : "无可用审批通道";
  throw new Error(`写操作 ${rawToolName} 未获确认（${why}），本次未写入任何数据。`);
}


// 子进程显式环境：SAP 连接 + 权限。SDK 会自动叠加安全白名单默认环境。
function buildChildEnv(cfg, password) {
  const env = {
    SAP_URL: String(cfg.url || ""),
    SAP_USER: String(cfg.user || ""),
    SAP_PASSWORD: String(password || ""),
    SAP_CLIENT: String(cfg.client || "000"),
    SAP_LANGUAGE: String(cfg.language || "EN"),
  };
  // 关键：宿主跑在 Electron 里，process.execPath 指向 DSH Desktop.exe 而非 node。
  // 必须显式设 ELECTRON_RUN_AS_NODE=1，Electron 才会以 Node 方式运行服务器脚本；
  // 否则会拉起一个全新的 DSH 应用实例，stdio 上没有 MCP 握手 → McpError Connection closed。
  // （dsh-web-app / main.js 里宿主 spawn Node 子进程正是这么做的。）
  env.ELECTRON_RUN_AS_NODE = "1";
  // 未开启任何权限 → 不传 MCP_ABAP_PERMISSIONS（服务器默认只读）。
  // 纵深防御：即使权限开启，缺少有效 permConfirm 也强制不传（保持只读）。
  const on = enabledPerms(cfg).filter(
    (k) => permConfirmValid(cfg).ok === true
  );
  const permsToPass = on.length > 0 ? cfg.permissions : {};
  if (Object.keys(permsToPass).some((k) => permsToPass[k] === true)) {
    env.MCP_ABAP_PERMISSIONS = JSON.stringify(permsToPass);
  }
  // 常见自签名证书场景：可通过 settings.language 之外的显式开关开启？这里保持默认关闭，
  // 用户如需要可在 settings.yaml 手工加 NODE_TLS_REJECT_UNAUTHORIZED（README 说明）。
  return env;
}

export function apply(ctx) {
  const settings = ctx.get("settings");
  if (settings === undefined || typeof settings.register !== "function") {
    console.error("[dsh-abap-mcp] settings service unavailable — plugin disabled");
    return;
  }

  let scope;
  try {
    scope = settings.register(NS, ConfigSchema, {});
  } catch (e) {
    console.error("[dsh-abap-mcp] settings.register failed:", e);
    return;
  }

  const read = () => {
    try {
      const v = scope.get();
      return ConfigSchema(v || {});
    } catch (e) {
      return ConfigSchema({});
    }
  };

  // 可选服务：credentials（dsh-base 提供，$DSH_HOME/.credentials.yaml）。每次调用时取，
  // 避免服务时序问题；缺失时回退到 settings 旧字段（此时仍是明文，保持旧行为并告警）。
  function creds() {
    const svc = ctx.get("credentials");
    return svc !== undefined && typeof svc.resolve === "function" && typeof svc.set === "function" ? svc : undefined;
  }

  // 密码解析：凭据库优先；settings 旧 password 字段仅作历史迁移/回退。
  // 一旦凭据库可用，就把旧明文从 settings 迁出并清空（无论最终值来自哪一层，settings 都不再留密码）。
  async function resolvePassword(cfg) {
    const svc = creds();
    let value = "";
    if (svc !== undefined) {
      try {
        const got = await svc.resolve(PASSWORD_REF);
        if (got && typeof got.value === "string" && got.value.length > 0) value = got.value;
      } catch (e) {
        value = "";
      }
    }
    const legacy = typeof cfg.password === "string" ? cfg.password : "";
    if (value.length === 0 && legacy.length > 0 && svc !== undefined) {
      try {
        await svc.set(PASSWORD_REF, legacy);
        value = legacy;
      } catch (e) {
        // 凭据库写不进（只读/被环境遮蔽等）：保持旧值，本次不清空，避免丢密码。
        return legacy;
      }
    }
    if (legacy.length > 0) {
      try {
        await scope.set("password", "");
      } catch (e) {
        /* ignore */
      }
    }
    return value;
  }

  // 仅参与重连判定的配置键（不含 status）。
  function configKey(cfg, password) {
    return JSON.stringify({
      enabled: cfg.enabled,
      url: cfg.url,
      user: cfg.user,
      password: password || "",
      client: cfg.client,
      language: cfg.language,
      permissions: cfg.permissions,
      // permConfirm 参与判定：补写令牌后需重新评估闸门并（若通过）以可写模式重连。
      permConfirm: cfg.permConfirm,
    });
  }

  // 状态发布：读当前 status 合并后再打补丁，避免不同发布方互相清空对方字段。
  // 典型：ensureConnected 的重连状态发布不得抹掉 runConnectionTest 刚写回的 lastTest，
  // 否则测试结果会在客户端一闪而过（“测试连接”闪烁且永远不显示结果）。
  function publishStatus(patch) {
    if (scope === undefined) return;
    try {
      let cur = {};
      try {
        const s = scope.get();
        if (s && s.status && typeof s.status === "object") cur = StatusSchema(s.status);
      } catch (e) {
        cur = StatusSchema({});
      }
      scope.update({ status: { ...cur, ...patch } }).catch(() => {});
    } catch (e) {
      /* 状态发布失败不影响主流程 */
    }
  }

  // ---------------- 连接管理 ----------------
  let connection = null; // { key, client, disposers }
  let disposed = false;
  let reconnectTimer = null;
  let configTimer = null;
  let failures = 0;

  async function syncTools(gen) {
    const list = await gen.client.listTools();
    const definitions = [];
    for (const t of list.tools) {
      definitions.push({
        name: publicToolName(t.name),
        description: t.description ?? "",
        parameters: t.inputSchema ?? {},
        output: {
          schema: {
            type: "object",
            additionalProperties: true,
            properties: {
              isError: { type: "boolean" },
              content: { type: "array" },
            },
          },
          render: (_args, value) => {
            const parts = [];
            if (value && Array.isArray(value.content)) {
              for (const c of value.content) {
                if (c && typeof c === "object" && c.type === "text" && typeof c.text === "string") parts.push(c.text);
              }
            }
            const text = parts.length > 0 ? parts.join("\n") : JSON.stringify(value, null, 2);
            return [{ type: "text", text }];
          },
        },
        execute: async (args, exec) => {
          // 写前人工确认：真实写工具（server CATEGORY_TOOLS 内的）在执行前必须先获
          // DSH 原生审批 'allowed-once'。未获批准会抛错，由调用管线转成 isError，
          // 本次不向 SAP 写入任何数据。只读工具不经过此闸门。
          // 受 schema 的 writeConfirm 总开关控制（默认 true=开启确认）；关闭后直接执行。
          const writeCat = loadWriteCategories().get(t.name);
          if (writeCat !== undefined && read().writeConfirm !== false) {
            await requireWriteApproval(ctx, t.name, args, exec);
          }
          const res = await gen.client.callTool(
            { name: t.name, arguments: typeof args === "object" && args !== null ? args : {} },
            undefined,
            { timeout: TOOL_CALL_TIMEOUT_MS }
          );
          if (res.isError === true) {
            const text = Array.isArray(res.content)
              ? res.content.filter((c) => c && c.type === "text").map((c) => c.text).join("\n")
              : "";
            throw new Error(text || `Tool ${t.name} failed`);
          }
          return res;
        },
      });
    }
    // 先释放旧代再注册新代：同名工具（如登录后工具列表重同步）必须先 dispose 旧的，
    // 否则 register 会抛 “already registered”。
    for (const dispose of gen.disposers.values()) dispose();
    gen.disposers.clear();
    const disposers = new Map();
    try {
      for (const d of definitions) disposers.set(d.name, ctx.tools.register(d));
    } catch (e) {
      for (const dispose of disposers.values()) dispose();
      throw e;
    }
    gen.disposers = disposers;
  }

  async function teardown(gen) {
    for (const dispose of gen.disposers.values()) dispose();
    gen.disposers.clear();
    try {
      await gen.client.close();
    } catch (e) {
      /* ignore */
    }
  }

  async function connect(cfg, password, opts = {}) {
    const entry = serverEntry();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: buildChildEnv(cfg, password),
    });
    const client = new Client({ name: "dsh-abap-mcp", version: "0.1.0" }, { capabilities: {} });
    const gen = { client, disposers: new Map(), closed: false, toolCount: 0 };

    client.onclose = () => {
      gen.closed = true;
      // 连接断开时立即释放本代已注册的工具，避免后续重连（或另一次并发连接）
      // 重新注册同名 mcp__abap__* 工具时抛 “already registered”。
      for (const dispose of gen.disposers.values()) dispose();
      gen.disposers.clear();
      if (connection === gen) {
        connection = null;
        scheduleReconnect("connection lost");
      }
    };
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      if (connection !== gen) return;
      try {
        await syncTools(gen);
        publishStatus({ tools: gen.disposers.size });
      } catch (e) {
        console.error("[dsh-abap-mcp] tool list re-sync failed:", String(e));
      }
    });

    await client.connect(transport);
    if (opts.registerTools === false) {
      // 测试模式：只做握手 + 枚举，不注册工具。
      // 持久连接通常已注册同名 mcp__abap__* 工具，再注册会抛 “already registered”。
      const list = await client.listTools();
      gen.toolCount = list.tools.length;
    } else {
      await syncTools(gen);
      gen.toolCount = gen.disposers.size;
    }
    return gen;
  }

  function scheduleReconnect(reason) {
    if (disposed) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (failures >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[dsh-abap-mcp] giving up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts (${reason}); change settings or restart the app to retry`
      );
      publishStatus({ ok: false, error: `连接中断，重试 ${MAX_RECONNECT_ATTEMPTS} 次后放弃（${reason}）` });
      return;
    }
    const delay = RECONNECT_BASE_DELAY_MS * 2 ** failures;
    failures += 1;
    console.warn(`[dsh-abap-mcp] ${reason}; reconnecting in ${delay}ms (attempt ${failures}/${MAX_RECONNECT_ATTEMPTS})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      ensureConnected("reconnect");
    }, delay);
  }

  // 串行化连接流程：startupTimer、settings/updated、after-test、reconnect 等多个来源
  // 可能并发调用 ensureConnected。若都直接进入 connect，会各自注册一批 mcp__abap__* 工具，
  // 第二个批次即抛 “already registered”。这里把调用排队成链，轮到谁就用当时的 read()
  // 最新配置执行；doEnsureConnected 内部的 key 幂等判断保证配置未变时自动跳过。
  let connectChain = Promise.resolve();
  function ensureConnected(reason) {
    const task = connectChain
      .then(() => doEnsureConnected(read(), reason))
      .catch((e) => console.error("[dsh-abap-mcp] connect task error:", String(e)));
    connectChain = task.catch(() => {});
    return task;
  }

  async function doEnsureConnected(cfg, reason) {
    if (disposed) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const password = await resolvePassword(cfg);
    const key = configKey(cfg, password);
    lastConnKey = key;
    if (connection && connection.key === key) return;

    if (connection) {
      const old = connection;
      connection = null;
      await teardown(old).catch(() => {});
    }

    if (!cfg.enabled || !cfg.url || !cfg.user || !password) {
      failures = 0;
      publishStatus({
        ok: false,
        error: !cfg.enabled ? "未启用（enabled=false）" : "缺少连接配置（url / user / password）",
        mode: "read-only",
        tools: 0,
        connectedAt: 0,
      });
      return;
    }

    // 权限人工确认闸门：开启了任意权限但缺少有效 permConfirm → 强制回退只读并提示。
    // 不回退重连、不进入重试退避（配置未变时 settings/updated 会被 configKey 忽略）。
    const gate = permConfirmValid(cfg);
    if (!gate.ok) {
      failures = 0;
      const safe = Object.assign({}, cfg, { permissions: {} });
      publishStatus({
        ok: false,
        error: gate.reason,
        mode: "read-only",
        tools: 0,
        connectedAt: 0,
      });
      console.warn(`[dsh-abap-mcp] ${gate.reason} — staying read-only`);
      return;
    }

    try {
      const gen = await connect(cfg, password);
      gen.key = key;
      connection = gen;
      failures = 0;
      const on = enabledPerms(cfg);
      const mode = on.length === 0 ? "read-only" : `read-only + ${on.join(",")}`;
      publishStatus({ ok: true, error: "", mode, tools: gen.disposers.size, connectedAt: Date.now() });
      console.info(`[dsh-abap-mcp] connected (${reason}): ${cfg.url} tools=${gen.disposers.size} mode=${mode}`);
    } catch (e) {
      console.error(`[dsh-abap-mcp] connect failed (${reason}):`, String(e));
      publishStatus({ ok: false, error: String(e), tools: 0, connectedAt: 0 });
      scheduleReconnect("connect failed");
    }
  }

  // 「测试连接」：用当前配置做一次真实的 spawn→connect→listTools→teardown，
  // 结果写回 status.lastTest（不建立/替换持久连接，不影响 enable 状态）。
  async function runConnectionTest(cfg) {
    if (disposed) return;
    const started = Date.now();
    publishStatus({ testing: true });
    try {
      const password = await resolvePassword(cfg);
      if (!cfg.url || !cfg.user || !password) {
        throw new Error("缺少连接配置（url / user / password）");
      }
      const gen = await connect(cfg, password, { registerTools: false });
      const tools = gen.toolCount;
      await teardown(gen);
      publishStatus({
        testing: false,
        lastTest: { ok: true, at: Date.now(), latencyMs: Date.now() - started, tools, error: "" },
      });
      console.info(`[dsh-abap-mcp] connection test OK (${Date.now() - started}ms, ${tools} tools)`);
    } catch (e) {
      console.error("[dsh-abap-mcp] connection test failed:", String(e));
      publishStatus({
        testing: false,
        lastTest: { ok: false, at: Date.now(), latencyMs: Date.now() - started, tools: 0, error: String(e) },
      });
    }
  }

  // ---------------- 生命周期 ----------------
  // 把持久化的旧 testRequest 视为已处理：只有启动后新写入的测试请求才触发测试，
  // 避免重启后对残留的时间戳又空跑一次连接测试。
  let lastHandledTestRequest = read().testRequest || 0;
  // 密码来自凭据库（异步解析），启动时无法同步算配置键；置 null，由 ensureConnected 首次写入。
  let lastConnKey = null;
  ensureConnected("startup");
  // 启动时序：credentials 服务（可选）与设置可能晚于本插件就绪，导致启动那次
  // ensureConnected 解析不到密码而误报「缺少连接配置」、持久连接未建立。
  // 用有界轮询补连：凭据可解析且配置完整后 ensureConnected 即建立持久连接；
  // 已连接时每次调用幂等返回（配置键未变），10 秒后停止。
  let startupRetries = 0;
  const startupTimer = setInterval(() => {
    startupRetries += 1;
    ensureConnected("startup-retry");
    if (startupRetries >= 10) clearInterval(startupTimer);
  }, 1000);

  // 配置变更 → 重连（去抖合并连续字段写入）。「测试连接」请求也在此响应。
  // 关键约束：
  //   1) 测试请求只做一次性测试；成功后若已启用则顺带确认持久连接（幂等），
  //      测试失败绝不触发持久连接/自动重试；
  //   2) 配置键未变（例如 Host 自身的 status 写回触发的 settings/updated）直接忽略，
  //      重连统一交给退避定时器，避免“测试报错后一直重试”。
  ctx.on("settings/updated", (ns) => {
    if (ns !== NS) return;
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(async () => {
      configTimer = null;
      const cfg = read();
      if (cfg.testRequest && cfg.testRequest !== lastHandledTestRequest) {
        lastHandledTestRequest = cfg.testRequest;
        await runConnectionTest(cfg).catch((e) => console.error("[dsh-abap-mcp] test task error:", String(e)));
        // 测试成功且已启用 → 顺带确认/建立持久连接（幂等：已连且配置键未变时直接返回）。
        // 这样「测试连接成功」后，卡片状态不会再停留在启动时遗留的失败态。
        if (cfg.enabled) {
          ensureConnected("after-test").catch((e) =>
            console.error("[dsh-abap-mcp] connect after test failed:", String(e))
          );
        }
        return;
      }
      const password = await resolvePassword(cfg);
      const key = configKey(cfg, password);
      if (key === lastConnKey) return;
      lastConnKey = key;
      ensureConnected("settings-change");
    }, 250);
  });

  // 密码保存在凭据库，改密码不会触发 settings/updated——监听凭据变更事件驱动重连。
  ctx.on("credentials/reference-updated", (ref) => {
    if (ref !== PASSWORD_REF) return;
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(() => {
      configTimer = null;
      ensureConnected("password-change");
    }, 250);
  });

  // 模型可见的状态查询工具。
  ctx.tools.register({
    name: "abap_mcp_status",
    description:
      "查询 dsh-abap-mcp 插件状态：是否启用、连接是否成功、当前权限模式、已注册 MCP 工具数量、连接配置（密码已隐藏）。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          enabled: { type: "boolean" },
          connected: { type: "boolean" },
          error: { type: "string" },
          mode: { type: "string" },
          tools: { type: "integer" },
          connectedAt: { type: "integer" },
          url: { type: "string" },
          user: { type: "string" },
          passwordConfigured: { type: "boolean" },
          permissions: { type: "object" },
          permissionGate: { type: "string" },
          writeConfirm: { type: "boolean" },
          writeApproval: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
    },
    execute: async () => {
      const cfg = read();
      const s = cfg.status || {};
      const on = enabledPerms(cfg);
      const gate = permConfirmValid(cfg);
      const password = await resolvePassword(cfg);
      return {
        enabled: cfg.enabled,
        connected: !!s.ok,
        error: s.error || "",
        mode: on.length === 0 ? "read-only" : (gate.ok ? `read-only + ${on.join(",")}` : "read-only"),
        tools: s.tools || 0,
        connectedAt: s.connectedAt || 0,
        url: cfg.url,
        user: cfg.user,
        passwordConfigured: password.length > 0,
        permissions: cfg.permissions,
        // 权限闸门提示：若开启了任意权限但未确认/已过期，返回给模型看（不暴露令牌本身）。
        permissionGate: on.length === 0 ? "ok" : (gate.ok ? "ok" : gate.reason),
        // 写确认开关状态（schema 默认 true）。关闭时写工具不再弹审批，直接执行。
        writeConfirm: cfg.writeConfirm !== false,
        // 写确认提示：开启时所有写工具执行前都会触发人工审批（DSH 原生审批卡），
        // 未获批准绝不写入。字段用于向模型说明该行为。
        writeApproval: `write confirmation is ${cfg.writeConfirm !== false ? "ON" : "OFF"}: ${[...loadWriteCategories().keys()].length} write tools ${cfg.writeConfirm !== false ? "require user approval before executing" : "execute without approval"}`,
      };
    },
  });

  // 卸载清理。
  ctx.effect(
    () => () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (configTimer) {
        clearTimeout(configTimer);
        configTimer = null;
      }
      clearInterval(startupTimer);
      if (connection) {
        const gen = connection;
        connection = null;
        teardown(gen).catch(() => {});
      }
    },
    "dsh-abap-mcp: connection"
  );
}
