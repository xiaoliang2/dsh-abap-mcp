import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { ADTClient } from "abap-adt-api";
import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";

// 跨对象源码 grep（只读）。
//
// 背景：ADT 的 Repository Information System 只提供「按对象名」搜索，没有服务端源码
// 内容检索。这里用纯只读手段实现：先用 name/package 圈定候选对象，再逐个 getObjectSource
// 拉取源码，在服务器侧用正则做行匹配。全部是只读操作，无需任何写权限或 SAP 侧代码。
//
// 默认只纳入「有源码」的对象类型（按 ADT type 前缀匹配，覆盖 PROG/P、PROG/I、CLAS/OC、
// INTF/OI、FUGR/F、FUGR/FF、DDLS/DF、XSLT/VT 等；类型后缀不影响匹配）。
const DEFAULT_SOURCE_TYPES = ["PROG", "CLAS", "INTF", "FUGR", "DDLS", "XSLT"];
const MAX_OBJECTS_CAP = 200;
const MAX_MATCHES_CAP = 500;

interface GrepTarget {
  name: string;
  type: string;
  packageName: string;
  url: string;
}

interface GrepHit extends GrepTarget {
  line: number;
  snippet: string;
}

function clampInt(value: unknown, def: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeObjTypes(objTypes: unknown, objType: unknown): string[] {
  const set = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string") {
      for (const t of v.split(",")) {
        const s = t.trim().toUpperCase();
        if (s) set.add(s);
      }
    } else if (Array.isArray(v)) {
      for (const t of v) add(t);
    }
  };
  add(objTypes);
  add(objType);
  return set.size > 0 ? [...set] : DEFAULT_SOURCE_TYPES;
}

function matchesType(objType: string | undefined, allowed: string[]): boolean {
  if (!objType) return false;
  const base = objType.split("/")[0].toUpperCase();
  return allowed.some((t) => base === t);
}

function sourceUrlFor(uri: string): string {
  if (!uri) return "";
  if (ADTClient.isMainInclude(uri)) return uri;
  return uri.replace(/\/+$/, "") + "/source/main";
}

function compilePattern(pattern: string, caseSensitive: boolean): RegExp {
  try {
    return new RegExp(pattern, caseSensitive ? "" : "i");
  } catch (e: any) {
    throw new McpError(ErrorCode.InvalidParams, `grep 正则无效: ${e.message}`);
  }
}

function grepSource(source: string, re: RegExp): Array<{ line: number; snippet: string }> {
  const lines = String(source ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const hits: Array<{ line: number; snippet: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      hits.push({ line: i + 1, snippet: lines[i] });
      re.lastIndex = 0;
    }
  }
  return hits;
}

// 带并发上限的 map：单个对象失败（无源码/无权限/404）不中断整体，记为 ok:false。
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<Array<{ ok: boolean; value?: R }>> {
  const out: Array<{ ok: boolean; value?: R }> = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = { ok: true, value: await fn(items[idx]) };
      } catch (e) {
        out[idx] = { ok: false };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export class SearchHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: "grepObjects",
        description:
          "在对象源码中按正则搜索（跨对象 grep，只读）。先用 name 对象名模式（如 YTEST*、ZCL_*）圈定候选，再逐个拉取源码做正则行匹配。请在 name 与 objType 上尽量收窄范围以控制耗时。",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "正则表达式，在源码中搜索（如 write、current user、lv_us_）",
            },
            name: {
              type: "string",
              description: "对象名模式，用于圈定候选对象（如 YTEST*、ZCL_MY*）",
            },
            objType: {
              type: "string",
              description: "对象类型（可省），如 PROG / CLAS / INTF / FUGR / INCL",
              optional: true,
            },
            objTypes: {
              type: "array",
              description: "对象类型数组（可省），与 objType 二选一或合并",
              optional: true,
            },
            maxObjects: {
              type: "number",
              description: "最多拉取源码的对象数（默认 25，上限 200）",
              optional: true,
            },
            maxMatches: {
              type: "number",
              description: "最多返回的命中行数（默认 100，上限 500）",
              optional: true,
            },
            caseSensitive: {
              type: "boolean",
              description: "是否区分大小写（默认否）",
              optional: true,
            },
          },
          required: ["pattern", "name"],
        },
      },
      {
        name: "grepPackages",
        description:
          "在指定开发包（package）内按正则搜索对象源码（只读）。用 package 内容枚举对象，再逐个拉取源码做正则行匹配。",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "正则表达式，在源码中搜索",
            },
            packageName: {
              type: "string",
              description: "开发包名称（如 ZDEV、$TMP）",
            },
            objType: {
              type: "string",
              description: "对象类型（可省），如 PROG / CLAS / INTF / FUGR / INCL",
              optional: true,
            },
            objTypes: {
              type: "array",
              description: "对象类型数组（可省）",
              optional: true,
            },
            maxObjects: {
              type: "number",
              description: "最多拉取源码的对象数（默认 40，上限 200）",
              optional: true,
            },
            maxMatches: {
              type: "number",
              description: "最多返回的命中行数（默认 100，上限 500）",
              optional: true,
            },
            caseSensitive: {
              type: "boolean",
              description: "是否区分大小写（默认否）",
              optional: true,
            },
          },
          required: ["pattern", "packageName"],
        },
      },
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case "grepObjects":
        return this.handleGrepObjects(args);
      case "grepPackages":
        return this.handleGrepPackages(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown search tool: ${toolName}`);
    }
  }

  private formatResult(pattern: string, searched: number, matched: number, hits: GrepHit[], scope: string) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "success",
              scope,
              pattern,
              objectsSearched: searched,
              matched,
              results: hits,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleGrepObjects(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const name = typeof args?.name === "string" ? args.name.trim() : "";
      const pattern = typeof args?.pattern === "string" ? args.pattern : "";
      if (!pattern) throw new McpError(ErrorCode.InvalidParams, "grepObjects 需要 pattern（正则）");
      if (!name) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "grepObjects 需要 name（对象名模式）来圈定候选对象；跨整个系统搜源码请改用 grepPackages 按包搜索"
        );
      }
      const caseSensitive = args?.caseSensitive === true;
      const re = compilePattern(pattern, caseSensitive);
      const objTypes = normalizeObjTypes(args?.objTypes, args?.objType);
      const maxObjects = clampInt(args?.maxObjects, 25, 1, MAX_OBJECTS_CAP);
      const maxMatches = clampInt(args?.maxMatches, 100, 1, MAX_MATCHES_CAP);

      const found = await this.adtclient.searchObject(
        name,
        objTypes.length === 1 ? objTypes[0] : undefined,
        maxObjects
      );
      const targets: GrepTarget[] = [];
      for (const o of found || []) {
        const type = String(o["adtcore:type"] ?? "");
        if (!matchesType(type, objTypes)) continue;
        const url = sourceUrlFor(String(o["adtcore:uri"] ?? ""));
        if (!url) continue;
        targets.push({
          name: String(o["adtcore:name"] ?? ""),
          type,
          packageName: String(o["adtcore:packageName"] ?? ""),
          url,
        });
      }

      const processed = await mapConcurrent(targets, 4, async (t) =>
        grepSource(await this.adtclient.getObjectSource(t.url), re)
      );
      const searched = processed.filter((r) => r && r.ok).length;
      const hits: GrepHit[] = [];
      for (let i = 0; i < targets.length && hits.length < maxMatches; i++) {
        const r = processed[i];
        if (!r || !r.ok) continue;
        for (const h of r.value!) {
          if (hits.length >= maxMatches) break;
          hits.push({ ...targets[i], line: h.line, snippet: h.snippet.trim() });
        }
      }

      this.trackRequest(startTime, true);
      return this.formatResult(pattern, searched, hits.length, hits, `searchObject(name='${name}')`);
    } catch (error: any) {
      this.trackRequest(startTime, false);
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `grepObjects 失败: ${error.message || "Unknown error"}`);
    }
  }

  async handleGrepPackages(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const packageName = typeof args?.packageName === "string" ? args.packageName.trim() : "";
      const pattern = typeof args?.pattern === "string" ? args.pattern : "";
      if (!pattern) throw new McpError(ErrorCode.InvalidParams, "grepPackages 需要 pattern（正则）");
      if (!packageName) throw new McpError(ErrorCode.InvalidParams, "grepPackages 需要 packageName（开发包）");
      const caseSensitive = args?.caseSensitive === true;
      const re = compilePattern(pattern, caseSensitive);
      const objTypes = normalizeObjTypes(args?.objTypes, args?.objType);
      const maxObjects = clampInt(args?.maxObjects, 40, 1, MAX_OBJECTS_CAP);
      const maxMatches = clampInt(args?.maxMatches, 100, 1, MAX_MATCHES_CAP);

      const nc = await this.adtclient.nodeContents("DEVC/K", packageName);
      const targets: GrepTarget[] = [];
      for (const n of nc?.nodes || []) {
        const type = String(n.OBJECT_TYPE ?? "");
        if (!matchesType(type, objTypes)) continue;
        const url = sourceUrlFor(String(n.OBJECT_URI ?? ""));
        if (!url) continue;
        targets.push({ name: String(n.OBJECT_NAME ?? ""), type, packageName, url });
        if (targets.length >= maxObjects) break;
      }

      const processed = await mapConcurrent(targets, 4, async (t) =>
        grepSource(await this.adtclient.getObjectSource(t.url), re)
      );
      const searched = processed.filter((r) => r && r.ok).length;
      const hits: GrepHit[] = [];
      for (let i = 0; i < targets.length && hits.length < maxMatches; i++) {
        const r = processed[i];
        if (!r || !r.ok) continue;
        for (const h of r.value!) {
          if (hits.length >= maxMatches) break;
          hits.push({ ...targets[i], line: h.line, snippet: h.snippet.trim() });
        }
      }

      this.trackRequest(startTime, true);
      return this.formatResult(pattern, searched, hits.length, hits, `package '${packageName}'`);
    } catch (error: any) {
      this.trackRequest(startTime, false);
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `grepPackages 失败: ${error.message || "Unknown error"}`);
    }
  }
}
