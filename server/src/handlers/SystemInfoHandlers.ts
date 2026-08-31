import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";

// 系统信息（只读）。
//
// 纯 ADT/SQL 实现，不需要任何 SAP 侧代码：
//   - SID：由 T000.LOGSYS（格式 <SID>CLNT<client>）推导；
//   - 客户端描述：T000 对应行；
//   - NetWeaver/ABAP 版本：CVERS 关键组件；
//   - 已安装组件：CVERS 全表。
// 所有查询都是只读 SELECT，经 ADT Data Preview 端点执行。

// getSystemInfo 展示的核心组件（CVERS.COMPONENT）。
const CORE_COMPONENTS = ["SAP_BASIS", "SAP_ABA", "SAP_BW", "SAP_GWFND", "SAP_UI", "ST-PI"];

function clampInt(value: unknown, def: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export class SystemInfoHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: "getSystemInfo",
        description:
          "获取系统信息（只读）：SID、客户端描述与类别、NetWeaver/ABAP 版本（来自 T000/CVERS）、登录用户与连接信息。",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "getInstalledComponents",
        description:
          "列出系统已安装组件及版本（只读，来自表 CVERS）。可用 pattern 过滤组件名（不区分大小写、子串匹配），如 SAP、EA、SAP_BASIS。",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "组件名过滤（子串匹配，不区分大小写），如 SAP / EA / SAP_BASIS",
              optional: true,
            },
            max: {
              type: "number",
              description: "最多返回条数（默认 300，上限 500）",
              optional: true,
            },
          },
        },
      },
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case "getSystemInfo":
        return this.handleSystemInfo(args);
      case "getInstalledComponents":
        return this.handleInstalledComponents(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown system info tool: ${toolName}`);
    }
  }

  async handleSystemInfo(_args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const client = String(this.adtclient.client ?? "");
      const clientNum = /^\d{3}$/.test(client) ? client : "";

      let clientInfo: any = null;
      if (clientNum) {
        try {
          const t000 = await this.adtclient.runQuery(
            `SELECT MANDT, MTEXT, ORT01, CCCATEGORY, LOGSYS FROM T000 WHERE MANDT = '${clientNum}'`,
            5,
            false
          );
          const row = t000?.values?.[0];
          if (row) {
            clientInfo = {
              mandate: row.MANDT,
              description: row.MTEXT,
              location: row.ORT01,
              clientCategory: row.CCCATEGORY,
              logSys: row.LOGSYS,
            };
          }
        } catch (e) {
          /* T000 不可读时跳过客户端信息 */
        }
      }

      const logSys = typeof clientInfo?.logSys === "string" ? clientInfo.logSys : "";
      const sid = logSys.includes("CLNT") ? logSys.split("CLNT")[0] : "";

      let release: any = null;
      try {
        const list = CORE_COMPONENTS.map((c) => `'${c}'`).join(",");
        const cvers = await this.adtclient.runQuery(
          `SELECT COMPONENT, RELEASE, COMP_TYPE FROM CVERS WHERE COMPONENT IN (${list})`,
          50,
          false
        );
        const vals = cvers?.values || [];
        const find = (c: string): string | null => {
          const v = vals.find((x: any) => x?.COMPONENT === c);
          return v && v.RELEASE != null ? String(v.RELEASE) : null;
        };
        release = {
          netweaver: find("SAP_BASIS"),
          abap: find("SAP_ABA"),
          gw: find("SAP_GWFND"),
          ui: find("SAP_UI"),
          bw: find("SAP_BW"),
          stpi: find("ST-PI"),
        };
      } catch (e) {
        /* CVERS 不可读时跳过版本信息 */
      }

      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                system: {
                  sid: sid || null,
                  baseUrl: this.adtclient.baseUrl,
                  client: this.adtclient.client,
                  language: this.adtclient.language,
                  user: this.adtclient.username,
                  loggedIn: this.adtclient.loggedin,
                  clientInfo,
                },
                release,
                message: "System information retrieved",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(ErrorCode.InternalError, `getSystemInfo 失败: ${error.message || "Unknown error"}`);
    }
  }

  async handleInstalledComponents(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const filter = typeof args?.pattern === "string" ? args.pattern.trim().toUpperCase() : "";
      const max = clampInt(args?.max, 300, 1, 500);

      const res = await this.adtclient.runQuery(
        "SELECT COMPONENT, RELEASE, COMP_TYPE FROM CVERS",
        Math.max(max, 500),
        false
      );
      let values = (res?.values || []).filter(
        (v: any) => !filter || String(v?.COMPONENT ?? "").toUpperCase().includes(filter)
      );
      values = values
        .slice()
        .sort((a: any, b: any) => String(a?.COMPONENT ?? "").localeCompare(String(b?.COMPONENT ?? "")))
        .slice(0, max);

      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                count: values.length,
                components: values,
                message: "Installed components retrieved",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(
        ErrorCode.InternalError,
        `getInstalledComponents 失败: ${error.message || "Unknown error"}`
      );
    }
  }
}
