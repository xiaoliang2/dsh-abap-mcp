# dsh-abap-mcp

A DeepSeek Harness (DSH) plugin that connects to SAP systems via **MCP (Model Context Protocol)** through the ABAP Development Tools (ADT) interface. The AI assistant can query SAP objects, run read-only inspections, and — only when you explicitly enable a permission category — perform write operations on the SAP system.

- **Default = strict read-only**: a curated read-only core is always available; all 7 write-category switches are off by default.
- **Manual confirmation for every permission**: permissions can only be turned on from the settings card (one-time token), so the AI can never enable write access by itself.
- **Flexible connection config**: enable/disable, URL, user, password, client, language.

> 中文版见 [README.md](./README.md) · Chinese version: [README.md](./README.md)

## Features

- Runs an MCP server as a child process of the DSH host, speaking the standard MCP protocol.
- Registers ~75 **read-only** tools (search, object structure, source reading, syntax check, code completion, reference lookup, DDIC reading, transport reading, table/SQL read, ATC/trace reading, revisions, health check, ...).
- 7 write categories (`sourceWrite`, `transports`, `refactor`, `exec`, `git`, `debug`, `serviceBinding`), off by default, gated server-side.
- Settings card on the DSH settings page + `abap_mcp_status` tool for connection status.
- Keep-alive: reconnects with bounded backoff (max 5 attempts) when config changes.

## Permission model (default = strict read-only)

The permission model is enforced **server-side** (`server/src/permissions.ts` → `dist/permissions.js`). The **read-only core** is always on; the 7 write categories are off by default and are enabled per category via the `MCP_ABAP_PERMISSIONS` environment variable. **Any tool not registered is denied by default** (deny-by-default), so a newly added handler can never slip through.

### Read-only core (~75 tools, always available)

| Sub-group | Tools | Purpose |
|---|---|---|
| Auth / Session | `login` `logout` `dropSession` | Login / logout / clear local session cache |
| Object discovery | `objectStructure` `searchObject` `findObjectPath` `objectTypes` `reentranceTicket` | Object structure / search / path lookup / object types / re-entrance ticket |
| Class introspection | `classIncludes` `classComponents` | Class includes / component listing |
| Code analysis (read-only) | `syntaxCheckCode` `syntaxCheckCdsUrl` `codeCompletion` `findDefinition` `usageReferences` `syntaxCheckTypes` `codeCompletionFull` `codeCompletionElement` `usageReferenceSnippets` `fixProposals` `fixEdits` `fragmentMappings` `abapDocumentation` | Syntax check / completion / definition jump / reference lookup / fix proposals / documentation |
| Source reading | `getObjectSource` | Read object source code |
| Inactive objects | `inactiveObjects` | List inactive objects |
| Registration / validation | `objectRegistrationInfo` `validateNewObject` | Object registration info / new-object parameter validation (read-only) |
| Transport reading | `transportInfo` `hasTransportConfig` `transportConfigurations` `getTransportConfiguration` `userTransports` `transportsByConfig` `systemUsers` `transportReference` | Transport request info / user transports / configs / system users (read-only) |
| Repository browsing | `nodeContents` `mainPrograms` | Object tree browsing / main programs of includes |
| Feature / discovery | `featureDetails` `collectionFeatureDetails` `findCollectionByUrl` `loadTypes` `adtDiscovery` `adtCoreDiscovery` `adtCompatibiliyGraph` | ADT capability discovery / feature queries |
| Unit-test result reading | `unitTestEvaluation` `unitTestOccurrenceMarkers` | Evaluate unit-test results / occurrence markers (read-only) |
| Pretty-printer setting (read) | `prettyPrinterSetting` | Read formatter settings (not modify) |
| Git reading | `gitRepos` `gitExternalRepoInfo` `checkRepo` `remoteRepoInfo` | Repo list / remote info / check (read-only) |
| DDIC reading | `annotationDefinitions` `ddicElement` `ddicRepositoryAccess` `packageSearchHelp` | Annotations / DDIC elements / package search (read-only) |
| Service-binding details | `bindingDetails` | Service binding details (read-only) |
| Data reading | `tableContents` `runQuery` | Table data / SQL query (read-only) |
| Feeds / Dumps | `feeds` `dumps` | Dynamic-object feeds / short-dump (ST22) list |
| Rename analysis | `renameEvaluate` `renamePreview` | Rename evaluation / preview (analysis only, no write) |
| ATC reading | `atcCustomizing` `atcCheckVariant` `atcWorklists` `atcUsers` `isProposalMessage` `atcContactUri` | ATC check customizing / variants / worklists / users / contacts (read-only) |
| Trace reading | `tracesList` `tracesListRequests` `tracesHitList` `tracesDbAccess` `tracesStatements` | Trace list / requests / hit list / DB access / statements (read-only) |
| Revisions / Health | `revisions` `healthcheck` | Object revision history / connection health check |

### 7 write categories (default: all off)

| Switch | Sub-category | Tools | Purpose |
|---|---|---|---|
| **`sourceWrite`** | Source write | `setObjectSource` `deleteObject` `activateObjects` `activateByName` `createObject` `createTestInclude` `lock` `unLock` | Write source / delete objects / activate / create objects / create test include / lock & unlock |
| **`transports`** | Transport requests | `createTransport` `setTransportsConfig` `createTransportsConfig` `transportDelete` `transportRelease` `transportSetOwner` `transportAddUser` | Create / configure / delete / release / change owner / add user |
| **`refactor`** | Refactoring | `renameExecute` `extractMethodEvaluate` `extractMethodPreview` `extractMethodExecute` `prettyPrinter` `setPrettyPrinterSetting` | Execute rename / extract method (evaluate/preview/execute) / formatting (read+write) |
| **`exec`** | Run classes | `runClass` `unitTestRun` | Run ABAP classes / run unit tests |
| | ATC write ops | `createAtcRun` `atcExemptProposal` `atcRequestExemption` `atcChangeContact` | Start an ATC run / exemption proposal / request exemption / change contact |
| | Trace config | `tracesSetParameters` `tracesCreateConfiguration` `tracesDeleteConfiguration` `tracesDelete` | Set trace parameters / create config / delete config / delete records |
| **`git`** | Git write ops | `gitCreateRepo` `gitPullRepo` `gitUnlinkRepo` `stageRepo` `pushRepo` `switchRepoBranch` | Create repo / pull / unlink / stage / push / switch branch |
| **`debug`** | Debugging | `debuggerListeners` `debuggerListen` `debuggerDeleteListener` `debuggerSetBreakpoints` `debuggerDeleteBreakpoints` `debuggerAttach` `debuggerSaveSettings` `debuggerStackTrace` `debuggerVariables` `debuggerChildVariables` `debuggerStep` `debuggerGoToStack` `debuggerSetVariableValue` | Listeners / breakpoints / attach / step / stack / variable read & write |
| **`serviceBinding`** | Service bindings | `publishServiceBinding` `unPublishServiceBinding` | Publish / unpublish OData service bindings |

> Note: the read-only "ATC reading", "trace reading", "Git reading" and "transport reading" groups only **read**. The write tools of the corresponding categories (start checks, change configs, push code, publish services, ...) require the permission switch. Rename **preview** (`renameEvaluate`/`renamePreview`) is read-only; the actual execution (`renameExecute`) needs `refactor`.

### Manual confirmation for permissions (prevents the AI from enabling them)

Enabling **any** permission switch requires **manual confirmation**: the settings card generates a **one-time confirmation token** (`confirm-<timestamp>-<random>`) and writes it into the config. The Host only allows a writable connection when the token is **fresh (within 60 seconds) and well-formed**; otherwise it forces read-only fallback and shows "requires manual confirmation on the settings card" in the status. This mechanism covers all 7 switches (`sourceWrite` / `transports` / `refactor` / `exec` / `git` / `debug` / `serviceBinding`) equally.

- **Permissions can only be enabled from the settings card.** Enabling via the `settings` API, editing `settings.yaml` directly, or asking the model to change `permissions` in the conversation is rejected because a valid token is missing.
- Tokens expire after 60 seconds and are reset on restart; re-enable from the card.
- Disabling all permissions (back to all-off) needs no confirmation and is always allowed.

### Per-write approval (every write prompts a human, toggleable)

On top of enabling a permission, there is a **second, per-call confirmation** before any real write executes — controlled by the **`writeConfirm` switch** on the settings card (**ON by default**):

- When the model calls any **write tool** (i.e. any tool listed in `CATEGORY_TOOLS` of `server/src/permissions.ts`, such as `setObjectSource` / `deleteObject` / `activateObjects` / `createTransport` / `renameExecute` / `pushRepo` / `debuggerSetBreakpoints`, …), DSH shows its **native approval card** with:
  - the tool name (e.g. `mcp__abap__setObjectSource`)
  - a human-readable summary of what will be written (target object name, URL, transport)
  - **for source-writing tools (`setObjectSource` / `createObject` / `createTestInclude`) a real "old → new" line-level diff**: the card inlines each change's `-`/`+` lines with line numbers and change counts (`+N/-M`); new objects show the full source line count
  - an **Allow once / Reject** choice
- **Numbered expandable preview card**: while a write tool runs, the conversation's tool card renders a "Write preview" — one **numbered button per change**; clicking a number expands that change's `-`/`+` diff. Large diffs are **never truncated** — content loads on demand. Approve/reject still lives on the native approval card; this card exists only to make clear "what will actually change".
- The write is forwarded to SAP **only after the user clicks "Allow once"**; rejection, cancellation, or an unavailable approval channel all **fail closed** (nothing is written).
- This reuses DSH's native approval channel (`ctx.approval` — the same mechanism used for file writes and command escalation), with built-in audit logging and no extra UI.
- Read-only tools bypass this gate and are unaffected.
- **With `writeConfirm` OFF**: write tools execute directly once their permission is enabled, without prompting (not recommended — only when you fully trust the write operations).
- The switch state is reflected in `abap_mcp_status.writeConfirm`; it does not participate in reconnect decisions.

### Security hardening: `runQuery` is read-only SQL only

`runQuery` lives in the read-only core, but it targets ADT Data Preview's freestyle SQL endpoint — some backends allow DML there. To stop it becoming a "no-permission, no-confirmation" hidden write channel, the server applies a **deterministic allowlist**: only a single statement starting with `SELECT` / `WITH` / `EXPLAIN` / `DESCRIBE` is allowed, and semicolon-stacked multi-statements are rejected. Anything like `UPDATE` / `INSERT` / `DELETE` / `DROP` is refused and never sent to the backend.

## Installation

### From npm (official package)

```bash
dsh plugin add @xiaobanli/dsh-abap-mcp
```

### Local directory (development / integration)

Add the dependency to the profile's `package.json` and run `pnpm install`:

```json
{
  "dependencies": {
    "@xiaobanli/dsh-abap-mcp": "link:C:/othersoftware/harness/harness/project6/dsh-abap-mcp"
  },
  "dsh": { "profile": { "bundles": [ "...", "dsh-abap-mcp" ] } }
}
```

After restarting DSH, an "ABAP MCP" card appears on the left side of the settings page.

## Configuration (settings-page card)

> **Prerequisites (check before connecting)**
> 1. **Enable the ADT service node in SICF on the SAP side**: the plugin accesses SAP through the HTTP(S) service of ABAP Development Tools (ADT). If the relevant ADT service nodes are inactive, the connection fails. In general, activate `default_host/sap/bc/adt` and its sub-nodes in transaction SICF (exact nodes vary slightly by system release).
> 2. **SAP URL format**: most systems use `http://host:port` or `https://host:port` (some newer/gateway setups use the full path `http://host:port/sap/bc/adt`). Confirm the protocol and port for your system, e.g. `http://10.0.0.1:8000` or `https://sap.example.com:44300`.

| Field | Description |
|---|---|
| Enable connection | Master switch; when off, no connection and no tools are registered |
| SAP URL | e.g. `http://host:port` / `https://host:port` (ADT service must be enabled first) |
| Username / Password | Connection credentials |
| Client / Language | e.g. `000` / `EN` |
| 7 write-permission switches | Check to enable the corresponding write capability |

### Recommended workflow

1. Fill in the SAP URL / username / password on the card (the password is stored in the DSH credentials store; the card is write-only).
2. Click "Test connection" first: a success result (~75 tools) means the config and network are fine.
3. Then turn on the "Enable connection" master switch.
4. **Wait a few seconds**, then check the connection status (the status block on the card, or ask the model for `abap_mcp_status`).
   - "Connected / read-only / N tools" means success.
   - If it still shows failure, paste the `error` field from `abap_mcp_status` for troubleshooting.

After saving, the Host reconnects per the current config; you can also ask the model for `abap_mcp_status` to view connection state in the conversation.

**"Test connection" button**: persists the current form first, then does a real spawn → connect → tool enumeration → disconnect using the current config. The result (success/failure, latency, tool count) is shown next to the button; it does **not** change the "Enable connection" switch.
- If SAP URL / username / password are missing, the button directly prompts "Please fill in the configuration first" without running a pointless test.
- While testing, the button shows "Testing…"; it times out automatically with a message after 60 seconds with no result.
- The test result (`status.lastTest`) stays visible next to the button and is not wiped by a reconnect-status refresh.
- The test is one-shot: it does **not** trigger a persistent connection or auto-reconnect, and a failed test does not enter the backoff retry; only a config change (enable switch / connection fields / permissions) triggers the persistent connection with bounded backoff (max 5 attempts before giving up).
- If the test succeeds while the connection is **enabled**, the plugin also brings up the persistent connection so the card shows connected immediately; a failed test leaves everything as-is (no retry, no reconnect).

## Building the server (after modifying `server/`)

```bash
cd server
npm install --ignore-scripts   # dependencies are pure JS, no lifecycle scripts needed
node node_modules/typescript/bin/tsc -p tsconfig.json   # produces dist/
```

## Troubleshooting

**"Test connection" stays "Testing…" or does nothing**
- Usually the settings write did not persist. Make sure SAP URL / username / password are filled in; the plugin writes the settings back to the local `settings.yaml`.
- If it keeps hanging, check the DSH log for `SettingsConflictError` (settings revision conflict causing the write to be dropped) — restart DSH and try again.

**`McpError: Connection closed`**
- The desktop host runs inside Electron; the child process must start in Node mode (the plugin already sets `ELECTRON_RUN_AS_NODE=1`).
- If it still occurs, confirm `server/dist/index.js` exists (no rebuild needed if `server/` sources were not modified); `node server/dist/index.js` staying alive in a terminal means the server itself is fine.

**Enabled a write switch but the tools did not appear**
- Permissions take effect server-side: after saving, the plugin **reconnects** and re-enumerates tools (the tool count should increase, e.g. 75 → 83).
- If the read-only tool count did not change, check the `mode` field of `abap_mcp_status` — it should have become `read-only + <category>`; if it is still `read-only`, the switch was not saved.

**Behavior did not change after editing `server/` sources**
- You need to rebuild: `cd server && npm install --ignore-scripts && node node_modules/typescript/bin/tsc -p tsconfig.json`, then restart DSH so the plugin picks up the new `dist/`.

**ABAP reports `STRING_OFFSET_TOO_LARGE` or similar at runtime**
- These errors come from the ABAP program being read/executed on the SAP side and are unrelated to the plugin. Use `mcp__abap__dumps` to inspect the short dump, or fix the program in SE38.

## Security notes

- **Read-only ≠ harmless**: read-only tools can still read source code and business data from the production system. **It is strongly recommended to connect to development/test systems with a least-privilege account** (the permission switches are a DSH-side guardrail, not a substitute for SAP-side authorization).
- The server prints the permission mode and a "recommended for dev/test only" notice at startup (a recommendation + notice, not enforcement).
- The password is kept in the DSH **credentials store** (`$DSH_HOME/.credentials.yaml`, `credentials` service, ref `SAP_PASSWORD`); the settings card is write-only and never reads it back. On first start the plugin migrates any plaintext password left in `settings.yaml` into the store and clears the legacy field. If `SAP_PASSWORD` is set in the launch environment it wins and the stored entry is read-only (same behavior as `DEEPSEEK_API_KEY`). Connection settings (`url` / `user` / `client` / `language` / permission switches) still live in `settings.yaml`.
- The server child process only inherits the SDK-allowlisted environment variables plus the `SAP_*` and `MCP_ABAP_PERMISSIONS` values explicitly injected by this plugin; it does not leak the host's remaining environment variables.

## License

MIT. The server part is derived from the original author mario-andreschak (MIT); this plugin adds a permission layer on top.
