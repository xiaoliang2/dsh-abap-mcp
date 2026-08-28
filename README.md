# dsh-abap-mcp

> # ⚠️ 实验阶段 · EXPERIMENTAL
>
> **本插件仍处于实验阶段（Experimental），仅供开发 / 测试（Dev / Test）环境使用。**
>
> - **请勿直接连接生产系统。** 即便默认只读，只读工具也能读取生产系统的源码与业务数据。
> - 请使用 **最小权限（least-privilege）的 SAP 账号** 连接。
> - 写权限开关（`sourceWrite` / `transports` / `refactor` / `exec` / `git` / `debug` / `serviceBinding`）**默认全部关闭**，仅在开发系统上按需、谨慎开启。
> - 密码保存在 DSH **凭据库**（`$DSH_HOME/.credentials.yaml`，引用名 `SAP_PASSWORD`），不写入配置文档，注意凭证安全。
>
> 使用本插件即表示你已知悉上述风险，并自行承担后果。

DeepSeek Harness 插件：通过 [MCP](https://modelcontextprotocol.io) 连接 **SAP ABAP ADT**，在 DSH 里直接查询/阅读 SAP 中的 ABAP 对象，**默认严格只读**，7 类写权限作为可配置开关。

> 上游服务器：[mario-andreschak/mcp-abap-abap-adt-api](https://github.com/mario-andreschak/mcp-abap-abap-adt-api)
> 本插件在 `server/` 里内置了**加了权限层**的服务器副本（默认只读 + 开关），并负责连接、注册工具、随设置变更重连。

---

## 架构

```
DSH 设置页卡片（ABAP MCP）
        │  settingsScope.set(...)   ←→  settings/updated
        ▼
Host 插件 lib/index.js
  1. settings.register("abap-mcp", schema)   # 连接配置 + 7 类权限开关 + 状态
  2. spawn `node server/dist/index.js`（StdioClientTransport，env=SAP_* + MCP_ABAP_PERMISSIONS）
  3. MCP Client 连接，把服务器工具注册为 mcp__abap__<tool>
  4. 配置变更 → 去抖重连；连接断开 → 有界退避重试
        ▼
server/dist/index.js（MCP 服务器，权限在这里强制生效）
  - MCP_ABAP_PERMISSIONS 未设置 → 默认只读（约 75 个只读工具）
  - 7 类写权限通过 MCP_ABAP_PERMISSIONS 的 JSON 开关启用
```

- **权限单一事实来源在服务器侧**：Host 只是把开关值透传给服务器，工具列表与调用都按权限过滤/拒绝。即使有人绕过 DSH 直接连服务器，权限依然生效。
- 工具命名：`mcp__abap__<工具名>`（如 `mcp__abap__searchObject`）。

## 权限模型（默认 = 严格只读）

权限模型在 **server 侧强制**（`server/src/permissions.ts` → `dist/permissions.js`）。默认**只读核心**始终开启；7 类写权限默认全关，通过 `MCP_ABAP_PERMISSIONS` 环境变量按类别开启。**未登记的任何工具一律拒绝**（deny-by-default），新增的 handler 不会悄悄放开。

### 只读核心（~75 个工具，始终开启）

| 子分组 | 工具 | 说明 |
|---|---|---|
| 认证 / 会话 | `login` `logout` `dropSession` | 登录 / 登出 / 清除本地会话缓存 |
| 对象发现 | `objectStructure` `searchObject` `findObjectPath` `objectTypes` `reentranceTicket` | 查对象结构 / 搜索 / 定位路径 / 对象类型 / 重入票 |
| 类内省 | `classIncludes` `classComponents` | 类的 include 组成 / 组件列表 |
| 代码分析（只读） | `syntaxCheckCode` `syntaxCheckCdsUrl` `codeCompletion` `findDefinition` `usageReferences` `syntaxCheckTypes` `codeCompletionFull` `codeCompletionElement` `usageReferenceSnippets` `fixProposals` `fixEdits` `fragmentMappings` `abapDocumentation` | 语法检查 / 补全 / 定义跳转 / 引用查询 / 修复建议 / 文档（只读） |
| 源码读取 | `getObjectSource` | 读取对象源码 |
| 非活动对象 | `inactiveObjects` | 列出未激活对象 |
| 注册 / 校验 | `objectRegistrationInfo` `validateNewObject` | 对象注册信息 / 新建对象参数校验（只读） |
| 传输读取 | `transportInfo` `hasTransportConfig` `transportConfigurations` `getTransportConfiguration` `userTransports` `transportsByConfig` `systemUsers` `transportReference` | 传输请求信息 / 用户传输 / 配置 / 系统用户（只读） |
| 仓库浏览 | `nodeContents` `mainPrograms` | 对象树浏览 / include 主程序 |
| 特性 / 发现 | `featureDetails` `collectionFeatureDetails` `findCollectionByUrl` `loadTypes` `adtDiscovery` `adtCoreDiscovery` `adtCompatibiliyGraph` | ADT 能力发现 / 特性查询 |
| 单测结果读取 | `unitTestEvaluation` `unitTestOccurrenceMarkers` | 评估单测结果 / 标记位置（只读） |
| 格式化设置读取 | `prettyPrinterSetting` | 读取格式化设置（不修改） |
| Git 读取 | `gitRepos` `gitExternalRepoInfo` `checkRepo` `remoteRepoInfo` | 仓库列表 / 远程信息 / 检查（只读） |
| DDIC 读取 | `annotationDefinitions` `ddicElement` `ddicRepositoryAccess` `packageSearchHelp` | 注解 / DDIC 元素 / 包搜索（只读） |
| 服务绑定详情 | `bindingDetails` | 服务绑定详情（只读） |
| 数据读取 | `tableContents` `runQuery` | 表数据 / SQL 查询（只读） |
| Feeds / Dumps | `feeds` `dumps` | 动态对象列表 / 短转储（dump）列表 |
| 改名分析 | `renameEvaluate` `renamePreview` | 改名评估 / 预览（只执行不落盘） |
| ATC 读取 | `atcCustomizing` `atcCheckVariant` `atcWorklists` `atcUsers` `isProposalMessage` `atcContactUri` | ATC 检查配置 / 变式 / 工作清单 / 用户 / 联系人（只读） |
| 追踪读取 | `tracesList` `tracesListRequests` `tracesHitList` `tracesDbAccess` `tracesStatements` | 追踪列表 / 请求 / 命中 / DB 访问 / 语句（只读） |
| 修订 / 健康 | `revisions` `healthcheck` | 对象修订历史 / 连接健康检查 |

### 7 类写权限（默认全关）

| 开关 | 子分类 | 工具 | 说明 |
|---|---|---|---|
| **`sourceWrite`** | 源码写入 | `setObjectSource` `deleteObject` `activateObjects` `activateByName` `createObject` `createTestInclude` `lock` `unLock` | 写源码 / 删对象 / 激活 / 建对象 / 建测试 include / 锁定与解锁 |
| **`transports`** | 传输请求 | `createTransport` `setTransportsConfig` `createTransportsConfig` `transportDelete` `transportRelease` `transportSetOwner` `transportAddUser` | 创建 / 配置 / 删除 / 释放 / 换负责人 / 加用户 |
| **`refactor`** | 重构 | `renameExecute` `extractMethodEvaluate` `extractMethodPreview` `extractMethodExecute` `prettyPrinter` `setPrettyPrinterSetting` | 改名执行 / 抽取方法（评估/预览/执行）/ 格式化（读写） |
| **`exec`** | 运行类 | `runClass` `unitTestRun` | 运行 ABAP 类 / 运行单元测试 |
| | ATC 写操作 | `createAtcRun` `atcExemptProposal` `atcRequestExemption` `atcChangeContact` | 发起 ATC 检查 / 豁免建议 / 请求豁免 / 改联系人 |
| | 追踪配置 | `tracesSetParameters` `tracesCreateConfiguration` `tracesDeleteConfiguration` `tracesDelete` | 设追踪参数 / 建配置 / 删配置 / 删记录 |
| **`git`** | Git 写操作 | `gitCreateRepo` `gitPullRepo` `gitUnlinkRepo` `stageRepo` `pushRepo` `switchRepoBranch` | 创建仓库 / 拉取 / 解除链接 / 暂存 / 推送 / 切分支 |
| **`debug`** | 调试 | `debuggerListeners` `debuggerListen` `debuggerDeleteListener` `debuggerSetBreakpoints` `debuggerDeleteBreakpoints` `debuggerAttach` `debuggerSaveSettings` `debuggerStackTrace` `debuggerVariables` `debuggerChildVariables` `debuggerStep` `debuggerGoToStack` `debuggerSetVariableValue` | 监听 / 断点 / 附加 / 单步 / 栈 / 变量读写 |
| **`serviceBinding`** | 服务绑定 | `publishServiceBinding` `unPublishServiceBinding` | 发布 / 取消发布 OData 服务绑定 |

> 说明：只读核心里的「ATC 读取」「追踪读取」「Git 读取」「传输读取」只能**读**；对应分类里的写工具（发起检查、改配置、推代码、发服务等）才需要开权限。改名前仅预览（`renameEvaluate`/`renamePreview`）是只读的，真正执行（`renameExecute`）才要 `refactor`。

### 权限人工确认（防止 AI 自行开启权限）

开启**任意**权限开关时，插件要求**人工确认**：设置页卡片在勾选时会生成一个**一次性确认凭据**（`confirm-<时间戳>-<随机串>`）写入配置，Host 侧仅在凭据**新鲜（60 秒内）且格式正确**时才允许以对应模式连接，否则强制回退只读并在状态里提示「需在设置卡片人工确认」。该机制覆盖全部 7 类权限开关（`sourceWrite` / `transports` / `refactor` / `exec` / `git` / `debug` / `serviceBinding`），一视同仁。

- **只能通过设置页卡片开启权限**。通过 `settings` API / 直接改 `settings.yaml` / 对话中让模型改 `permissions` 的方式开启，都会因缺少有效凭据而被拒绝。
- 凭据有 60 秒时效，重启后自动过期，需重新在卡片操作。
- 关闭全部权限（回到全关）无需确认，始终允许。

## 安装

### 从 npm（正式包）

```bash
dsh plugin add @xiaobanli/dsh-abap-mcp
```

### 本地目录（开发/联调）

在 profile 的 `package.json` 增加依赖并执行 `pnpm install`：

```json
{
  "dependencies": {
    "@xiaobanli/dsh-abap-mcp": "link:C:/othersoftware/harness/harness/project6/dsh-abap-mcp"
  },
  "dsh": { "profile": { "bundles": [ "...", "dsh-abap-mcp" ] } }
}
```

重启 DSH 后，设置页左侧会出现「ABAP MCP」卡片。

## 配置（设置页卡片）

> **前置准备（连接前请确认）**
> 1. **SAP 侧需在事务码 SICF 中开启 ADT 服务节点**：插件通过 ABAP Development Tools (ADT) 的 HTTP(S) 服务访问 SAP，若相关 ADT 服务节点未激活，连接会失败。一般在 SICF 里激活 `default_host/sap/bc/adt` 及其子节点即可（具体节点随系统版本略有差异）。
> 2. **SAP 地址格式**：大多数为 `http://地址:端口` 或 `https://地址:端口`（部分高版本/网关配置为 `http://地址:端口/sap/bc/adt` 的完整路径）。请根据实际系统确认协议与端口，例如 `http://10.0.0.1:8000` 或 `https://sap.example.com:44300`。

| 字段 | 说明 |
|---|---|
| 启用连接 | 总开关；关闭时不连接、不注册任何工具 |
| SAP 地址 | 如 `http://地址:端口` / `https://地址:端口`（需先开启 ADT 服务） |
| 用户名 / 密码 | 连接凭证 |
| 客户端 / 语言 | 如 `000` / `EN` |
| 7 类写权限开关 | 勾选即启用对应写能力 |

### 推荐操作流程

1. 在卡片填好 SAP 地址 / 用户名 / 密码（密码写入 DSH 凭据库，卡片只写不读）。
2. 先点「测试连接」：显示成功（工具数约 75）即说明配置与网络都没问题。
3. 再打开「启用连接」开关（总开关）。
4. **稍等几秒**，再查看连接状态（卡片状态块，或在对话里问模型 `abap_mcp_status`）。
   - 状态变为「已连接 / read-only / N 个工具」即成功。
   - 若仍显示失败，把 `abap_mcp_status` 返回的 `error` 字段贴出来排查。

配置保存后 Host 会按当前配置重连；也可以直接问模型 `abap_mcp_status` 查看连接状态。

「测试连接」按钮：先把当前表单落盘，再用当前配置做一次真实的 spawn→连接→工具枚举→断开，
结果（成功/失败、耗时、工具数）显示在按钮旁；不改变「启用连接」开关状态。
- 未填写 SAP 地址 / 用户名 / 密码时，按钮直接提示「请先填写配置」，不会空跑一次测试。
- 测试进行中按钮显示「测试中…」；60 秒无结果自动判超时并提示。
- 测试结果（`status.lastTest`）会持续显示在按钮旁，不会被重连状态刷新抹掉。
- 测试是一次性动作：**不会**触发持久连接或自动重连，测试失败也不会进入退避重试；
  仅当配置变更（启用开关/连接字段/权限）时才触发持久连接与有界重连（最多 5 次后放弃）。
- 若「测试连接」成功且当前**已启用**，插件会顺带建立持久连接，卡片状态立即变为已连接；
  测试失败则保持原状（不重试、不重连）。

## 构建服务器（修改 server/ 后）

```bash
cd server
npm install --ignore-scripts   # 依赖均为纯 JS，无需生命周期脚本
node node_modules/typescript/bin/tsc -p tsconfig.json   # 产出 dist/
```

## 故障排查（Troubleshooting）

**「测试连接」一直显示「测试中…」，或点了没反应**
- 多半是设置写入没落盘成功。确认 SAP 地址 / 用户名 / 密码都已填写；插件会把设置写回本地 `settings.yaml`。
- 若反复卡住，检查 DSH 日志里是否有 `SettingsConflictError`（设置 revision 冲突导致写入被丢弃）——重启 DSH 后再试一次。

**连接报 `McpError: Connection closed`**
- 桌面版宿主跑在 Electron 里，子进程需要以 Node 模式启动（插件已自动设置 `ELECTRON_RUN_AS_NODE=1`）。
- 若仍出现，确认 `server/dist/index.js` 存在（未修改 `server/` 源码则无需重新构建）；直接 `node server/dist/index.js` 能在终端待命说明服务器本身正常。

**启用了某写权限开关，但对应工具没出现**
- 权限的真正生效点在服务器侧：开关保存后插件会**重连**并重新枚举工具（工具数应增加，如 75 → 83）。
- 权限只读工具数不变时，检查 `abap_mcp_status` 的 `mode` 是否已变成 `read-only + <类别>`；若仍是 `read-only`，说明开关没保存成功。

**改完 `server/` 源码后工具行为没变化**
- 需要重新构建：`cd server && npm install --ignore-scripts && node node_modules/typescript/bin/tsc -p tsconfig.json`，然后重启 DSH 让插件用上新的 `dist/`。

**运行期 ABAP 报 `STRING_OFFSET_TOO_LARGE` 等错误**
- 这类错误来自 SAP 侧被读取/执行的 ABAP 程序本身，与插件无关。用 `mcp__abap__dumps` 查看短转储详情，或在 SE38 里修正对应程序。

## 安全说明

- **只读 ≠ 无害**：只读工具仍可能读取生产系统里的源码与业务数据。**强烈建议连开发/测试系统，使用最小权限账号**（权限开关只是 DSH 侧的护栏，不替代 SAP 侧的授权）。
- 服务器会在启动时打印权限模式与"建议仅用于开发/测试系统"的提示（这是建议 + 提示，不强制）。
- 密码保存在 DSH **凭据库**（`$DSH_HOME/.credentials.yaml`，`credentials` 服务，引用名 `SAP_PASSWORD`），设置卡片只写不读；首次启动会把历史 `settings.yaml` 里的明文密码自动迁移进凭据库并清空旧字段。若启动环境已设置 `SAP_PASSWORD`，以环境变量为准且凭据条目只读（与 `DEEPSEEK_API_KEY` 同款行为）。连接配置（`url` / `user` / `client` / `language` / 权限开关）仍写在 `settings.yaml`。
- 服务器子进程只继承 SDK 白名单环境变量 + 本插件显式注入的 `SAP_*` 与 `MCP_ABAP_PERMISSIONS`，不泄漏宿主其余环境变量。

## License

MIT。服务器部分版权归原作者 mario-andreschak（MIT），本插件在其基础上加入权限层。
