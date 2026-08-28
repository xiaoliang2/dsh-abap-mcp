// dsh-abap-mcp — client bundle (browser)
// 在 设置 左侧导航注册一个「ABAP MCP」独立页面（settings.section）：
//   - 连接配置：启用开关、SAP 地址 / 用户名 / 密码 / 客户端 / 语言（保存后 Host 重连）
//   - 7 类写权限开关（默认全关 = 严格只读；真正生效点在服务器侧）
//   - 运行状态读条（Host 写回 status：连接是否成功、权限模式、工具数）
// 数据来源：订阅 Host 维护的 settings namespace `abap-mcp`。
// 构建格式与 DSH 其他 client 插件一致：window.__ModuleLoader__.load(...)。

window.__ModuleLoader__.load({
  id: "@xiaobanli/dsh-abap-mcp",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var useSyncExternalStore = React.useSyncExternalStore;

    var NS = "abap-mcp";

    var zh = {
      "card.title": "ABAP MCP",
      "card.subtitle": "通过 MCP 连接 SAP ABAP ADT（默认只读）",
      "card.enabled": "启用连接",
      "card.conn": "连接配置",
      "card.url": "SAP 地址（https://host:port/sap/bc/adt）",
      "card.user": "用户名",
      "card.password": "密码",
      "card.password.keep": "已配置，留空保持不变",
      "card.password.unset": "未设置",
      "card.password.clear": "清除密码",
      "card.client": "客户端（Client）",
      "card.language": "语言",
      "card.save": "保存并应用",
      "card.saved": "已保存",
      "card.test": "测试连接",
      "card.testing": "测试中…",
      "card.test.ok": "上次测试：成功",
      "card.test.fail": "上次测试：失败",
      "card.test.tools": "{n} 个工具",
      "card.test.never": "尚未测试",
      "card.test.needConfig": "请先填写 SAP 地址 / 用户名 / 密码",
      "card.test.timeout": "测试超时（60 秒未返回结果）",
      "card.test.failWrite": "测试请求未能送达 Host，请重试",
      "card.perms": "写权限开关（默认全关 = 严格只读）",
      "card.perm.sourceWrite": "对象写入：创建/编辑/删除/激活/锁定",
      "card.perm.transports": "传输请求：创建/释放/删除/配置",
      "card.perm.refactor": "重构：改名执行/抽取方法/格式化",
      "card.perm.exec": "执行：运行类/单元测试/ATC/追踪配置",
      "card.perm.git": "Git：拉取/暂存/推送/切换分支",
      "card.perm.debug": "调试：断点/单步/附加/变量读写",
      "card.perm.serviceBinding": "服务绑定：发布/取消发布",
      "card.status": "运行状态",
      "card.status.waiting": "未连接（等待配置并启用）",
      "card.status.ok": "已连接",
      "card.status.err": "连接失败",
      "card.tools": "已注册工具",
      "card.mode": "权限模式",
      "card.note": "⚠ 仅建议在开发/测试系统使用最小权限账号；密码保存在 DSH 凭据库（.credentials.yaml），不写入配置文档。连接配置变更会自动重连。",
      "card.permConfirm": "开启任意权限需在本卡片确认（自动生成一次性凭据）；通过其他方式修改的权限不会生效。",
    };

    var en = {
      "card.title": "ABAP MCP",
      "card.subtitle": "Connect to SAP ABAP ADT over MCP (read-only by default)",
      "card.enabled": "Enable connection",
      "card.conn": "Connection",
      "card.url": "SAP URL (https://host:port/sap/bc/adt)",
      "card.user": "User",
      "card.password": "Password",
      "card.password.keep": "Configured — leave blank to keep",
      "card.password.unset": "Not set",
      "card.password.clear": "Clear password",
      "card.client": "Client",
      "card.language": "Language",
      "card.save": "Save & apply",
      "card.saved": "Saved",
      "card.test": "Test connection",
      "card.testing": "Testing…",
      "card.test.ok": "Last test: OK",
      "card.test.fail": "Last test: failed",
      "card.test.tools": "{n} tools",
      "card.test.never": "Not tested yet",
      "card.test.needConfig": "Fill in SAP URL / user / password first",
      "card.test.timeout": "Test timed out (no result in 60s)",
      "card.test.failWrite": "Failed to send test request to host, please retry",
      "card.perms": "Write permissions (all off = strict read-only)",
      "card.perm.sourceWrite": "Object write: create/edit/delete/activate/lock",
      "card.perm.transports": "Transports: create/release/delete/configure",
      "card.perm.refactor": "Refactor: rename-execute/extract-method/pretty-print",
      "card.perm.exec": "Exec: run class/unit test/ATC/trace config",
      "card.perm.git": "Git: pull/stage/push/switch branch",
      "card.perm.debug": "Debug: breakpoints/step/attach/variable write",
      "card.perm.serviceBinding": "Service binding: publish/unpublish",
      "card.status": "Runtime status",
      "card.status.waiting": "Not connected (configure and enable)",
      "card.status.ok": "Connected",
      "card.status.err": "Connection failed",
      "card.tools": "Registered tools",
      "card.mode": "Permission mode",
      "card.note": "⚠ Recommended for dev/test systems with a least-privilege account. The password is kept in the DSH credentials store (.credentials.yaml), not in the config document. Config changes auto-reconnect.",
      "card.permConfirm": "Enabling any permission must be confirmed from this card (a one-time token is generated); permissions changed by other means won't take effect.",
    };

    var PERMS = [
      "sourceWrite",
      "transports",
      "refactor",
      "exec",
      "git",
      "debug",
      "serviceBinding",
    ];

    var styles = {
      card: { display: "flex", flexDirection: "column", gap: "10px", padding: "4px 0" },
      head: { display: "flex", flexDirection: "column", gap: "2px" },
      title: { fontSize: "16px", fontWeight: 700, color: "var(--dsw-alias-label-primary)" },
      subtitle: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", margin: "0" },
      section: { fontSize: "13px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", marginTop: "6px" },
      row: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", flexWrap: "wrap" },
      label: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", minWidth: "120px" },
      input: {
        flex: "1",
        minWidth: "260px",
        padding: "5px 8px",
        fontSize: "12px",
        background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.10))",
        color: "var(--dsw-alias-label-primary)",
        border: "1px solid var(--dsw-alias-stroke-default, rgba(128,128,128,0.35))",
        borderRadius: "4px",
      },
      saveBtn: {
        padding: "6px 14px",
        fontSize: "12px",
        fontWeight: 600,
        background: "var(--dsw-alias-state-business-primary, #2563eb)",
        color: "var(--dsw-alias-label-primary-foreground, #fff)",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
      },
      saved: { fontSize: "12px", color: "var(--dsw-alias-state-success-primary)", marginLeft: "8px" },
      testBtn: {
        padding: "6px 14px",
        fontSize: "12px",
        fontWeight: 600,
        background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.10))",
        color: "var(--dsw-alias-label-primary)",
        border: "1px solid var(--dsw-alias-stroke-default, rgba(128,128,128,0.35))",
        borderRadius: "4px",
        cursor: "pointer",
      },
      clearBtn: {
        padding: "4px 10px",
        fontSize: "11px",
        fontWeight: 600,
        background: "transparent",
        color: "var(--dsw-alias-state-error-primary)",
        border: "1px solid var(--dsw-alias-stroke-default, rgba(128,128,128,0.35))",
        borderRadius: "4px",
        cursor: "pointer",
        whiteSpace: "nowrap",
      },
      badge: { display: "inline-block", padding: "0 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600, border: "none", cursor: "pointer" },
      on: { background: "var(--dsw-alias-state-success-primary)", color: "#fff" },
      off: { background: "var(--dsw-alias-state-warn-primary)", color: "#000" },
      permRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "12px" },
      statusOk: { color: "var(--dsw-alias-state-success-primary)", fontWeight: 600 },
      statusErr: { color: "var(--dsw-alias-state-error-primary)", fontWeight: 600 },
      statusWait: { color: "var(--dsw-alias-label-secondary)", fontWeight: 600 },
      hint: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)", margin: "0" },
      note: {
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--dsw-alias-state-warn-primary)",
        background: "color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)",
        padding: "6px 10px",
        borderRadius: "4px",
        margin: "0",
      },
    };

    function AbapMcpCard({ t, scope, api, remote, passwordRef }) {
      var snapshot = useSyncExternalStore(
        function (subscribe) {
          return scope.subscribe(subscribe);
        },
        function () {
          return scope.getSnapshot();
        }
      );
      var value = snapshot.value ?? {};
      var enabled = value.enabled === true;
      var url = typeof value.url === "string" ? value.url : "";
      var user = typeof value.user === "string" ? value.user : "";
      var client = typeof value.client === "string" ? value.client : "000";
      var language = typeof value.language === "string" ? value.language : "EN";
      var perms = value.permissions && typeof value.permissions === "object" ? value.permissions : {};
      var status = value.status && typeof value.status === "object" ? value.status : {};

      // 文本字段先暂存本地草稿，点「保存」一次性提交（避免逐键触发重连）。
      // 密码不来自 settings：保存在凭据库、客户端读不回明文，本地草稿恒为空串起步。
      var state = React.useState({
        url: url,
        user: user,
        password: "",
        client: client,
        language: language,
      });
      var draft = state[0];
      var setDraft = state[1];
      var savedState = React.useState(false);
      var saved = savedState[0];
      var setSaved = savedState[1];
      var testingState = React.useState(false);
      var testPending = testingState[0];
      var setTestPending = testingState[1];
      // 「测试连接」的本地提示（如“请先填写配置”/“测试超时”）与超时定时器。
      var msgState = React.useState("");
      var testMsg = msgState[0];
      var setTestMsg = msgState[1];
      var timeoutRef = React.useRef(null);

      // 凭据库里的“是否已配置密码”（只读状态，读不回明文）。
      var pwdState = React.useState(false);
      var passwordConfigured = pwdState[0];
      var setPwdConfigured = pwdState[1];

      function readPasswordConfigured() {
        if (!api) return Promise.resolve(false);
        return api.credentials.describe({ refs: [passwordRef] }).then(function (resp) {
          var view = resp && resp.result && resp.result.value && resp.result.value.credentials
            ? resp.result.value.credentials[passwordRef]
            : null;
          var next = !!(view && view.configured);
          setPwdConfigured(next);
          return next;
        }).catch(function () { return false; });
      }

      // 密码写入 DSH 凭据库（api.credentials.set），写后清掉本地回显、刷新“已配置”状态。
      function writePassword(value) {
        if (!api) return Promise.resolve();
        return api.credentials.set({ ref: passwordRef, value: value }).then(function () {
          setDraft(Object.assign({}, draft, { password: "" }));
          return readPasswordConfigured();
        }).catch(function () { return false; });
      }

      function clearPassword() {
        if (!api) return;
        api.credentials.unset({ ref: passwordRef }).then(readPasswordConfigured).catch(function () {});
      }

      // 挂载时读一次“是否已配置密码”，并订阅凭据变更事件保持同步（例如其他入口写了同一引用）。
      React.useEffect(function () {
        if (!api) return;
        var cancelled = false;
        function refresh() {
          api.credentials.describe({ refs: [passwordRef] }).then(function (resp) {
            if (cancelled) return;
            var view = resp && resp.result && resp.result.value && resp.result.value.credentials
              ? resp.result.value.credentials[passwordRef]
              : null;
            setPwdConfigured(!!(view && view.configured));
          }).catch(function () {});
        }
        refresh();
        if (!remote) return function () { cancelled = true; };
        var off = remote.$on("credentials/reference-updated", function (ref) {
          if (ref === passwordRef) refresh();
        });
        return function () {
          cancelled = true;
          if (off) off();
        };
      }, []);

      function commitFields() {
        setSaved(false);
        var writes = [
          scope.set("url", draft.url || ""),
          scope.set("user", draft.user || ""),
          scope.set("client", draft.client || "000"),
          scope.set("language", draft.language || "EN")
        ];
        if (draft.password) writes.push(writePassword(draft.password));
        return Promise.all(writes).then(function () {
          setSaved(true);
          return true;
        }).catch(function () {
          setSaved(true);
          return false;
        });
      }

      // testRequest 写入可能因 settings revision 冲突被静默丢弃（写入管线 recover 只重载镜像、不重试）。
      // 这里写入后回读快照确认到账，未到账就重试——recover 后拿到的就是新的 revision，重试即可成功。
      function writeTestRequest() {
        var T = Date.now();
        return new Promise(function (resolve) {
          var attempts = 0;
          function attempt() {
            attempts++;
            scope.set("testRequest", T).then(function () {
              var snap = scope.getSnapshot();
              var ok = snap && snap.value && snap.value.testRequest === T;
              if (ok) return resolve(true);
              if (attempts >= 4) return resolve(false);
              setTimeout(attempt, 400);
            });
          }
          attempt();
        });
      }

      // 「测试连接」：先本地校验必填项（避免空输入也去 Host 空转一轮导致闪烁），
      // 通过后再把当前表单落盘并向 Host 发出测试请求（时间戳）。
      function testConnection() {
        var hasPwd = !!(draft.password || "").trim() || passwordConfigured;
        var need = !(draft.url || "").trim() || !(draft.user || "").trim() || !hasPwd;
        if (need) {
          setTestMsg(t("card.test.needConfig"));
          setTestPending(false);
          return;
        }
        setTestMsg("");
        setTestPending(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(function () {
          setTestPending(false);
          setTestMsg(t("card.test.timeout"));
        }, 60000);
        // 先落盘（含密码→凭据库），再发测试请求；测试要用新配置。
        commitFields().then(function () {
          return writeTestRequest();
        }).then(function (ok) {
          if (!ok) {
            setTestPending(false);
            setTestMsg(t("card.test.failWrite"));
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
          }
        });
      }

      // 主机写回测试结果（testing 归 false 且 lastTest 有记录）→ 清除本地“测试中”并撤销超时。
      React.useEffect(function () {
        if (testPending && status.testing === false && status.lastTest && status.lastTest.at > 0) {
          setTestPending(false);
          setTestMsg("");
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        }
      }, [testPending, status.testing, status.lastTest]);
      // 卸载时清理测试超时定时器。
      React.useEffect(function () {
        return function () {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
      }, []);
      var testing = testPending || status.testing === true;
      var lastTest = status.lastTest && typeof status.lastTest === "object" ? status.lastTest : null;

      function toggleEnabled() {
        scope.set("enabled", !enabled);
      }

      function togglePerm(id) {
        var next = Object.assign({}, perms, { [id]: !perms[id] });
        var hasOn = Object.keys(next).some(function (k) { return next[k] === true; });
        scope.set("permissions", next);
        // 权限人工确认凭据：开启任意权限时必须生成令牌（Host 侧 60 秒内校验生效）；
        // 全部关闭时清空令牌。令牌由卡片生成，AI 无法在窗口内猜中 → 开启权限只能人工完成。
        if (hasOn) {
          var rand = Array.from(crypto.getRandomValues(new Uint8Array(6)))
            .map(function (b) { return b.toString(16).padStart(2, "0"); })
            .join("");
          scope.set("permConfirm", "confirm-" + Date.now() + "-" + rand);
        } else {
          scope.set("permConfirm", "");
        }
      }

      function field(label, key, placeholder, type) {
        return React.createElement("div", { style: styles.row },
          React.createElement("span", { style: styles.label }, label),
          React.createElement("input", {
            style: styles.input,
            type: type || "text",
            placeholder: placeholder || "",
            value: draft[key],
            onChange: function (e) {
              var next = Object.assign({}, draft);
              next[key] = e.target.value;
              setDraft(next);
              setSaved(false);
              setTestMsg("");
            },
          }));
      }

      var mode = "read-only";
      var on = PERMS.filter(function (p) { return perms[p] === true; });
      if (on.length > 0) mode = "read-only + " + on.join(",");
      if (typeof status.mode === "string" && status.mode) mode = status.mode;

      return React.createElement("div", { style: styles.card },
        React.createElement("div", { style: styles.head },
          React.createElement("span", { style: styles.title }, t("card.title")),
          React.createElement("p", { style: styles.subtitle }, t("card.subtitle"))),

        React.createElement("div", { style: styles.section }, t("card.enabled")),
        React.createElement("div", { style: styles.row },
          React.createElement("button", {
            style: Object.assign({}, styles.badge, enabled ? styles.on : styles.off),
            onClick: toggleEnabled,
          }, (enabled ? "ON " : "OFF ") + t("card.enabled"))),

        React.createElement("div", { style: styles.section }, t("card.status")),
        React.createElement("div", { style: styles.row },
          status.ok === true
            ? React.createElement("span", { style: styles.statusOk }, "● " + t("card.status.ok"))
            : (status.error
                ? React.createElement("span", { style: styles.statusErr }, "● " + t("card.status.err"))
                : React.createElement("span", { style: styles.statusWait }, "○ " + t("card.status.waiting"))),
          React.createElement("span", { style: styles.hint }, t("card.mode") + ": " + mode),
          React.createElement("span", { style: styles.hint }, t("card.tools") + ": " + (status.tools || 0))),
        status.error ? React.createElement("p", { style: styles.statusErr }, status.error) : null,

        React.createElement("div", { style: styles.section }, t("card.conn")),
        field(t("card.url"), "url", "https://host:port/sap/bc/adt"),
        field(t("card.user"), "user", ""),
        React.createElement("div", { style: styles.row },
          React.createElement("span", { style: styles.label }, t("card.password")),
          React.createElement("input", {
            style: styles.input,
            type: "password",
            placeholder: passwordConfigured ? t("card.password.keep") : t("card.password.unset"),
            value: draft.password,
            onChange: function (e) {
              var next = Object.assign({}, draft);
              next.password = e.target.value;
              setDraft(next);
              setSaved(false);
              setTestMsg("");
            },
          }),
          passwordConfigured
            ? React.createElement("button", { style: styles.clearBtn, onClick: clearPassword }, t("card.password.clear"))
            : null),
        React.createElement("div", { style: styles.row },
          field(t("card.client"), "client", "000"),
          field(t("card.language"), "language", "EN")),
        React.createElement("div", { style: styles.row },
          React.createElement("button", { style: styles.saveBtn, onClick: commitFields }, t("card.save")),
          saved ? React.createElement("span", { style: styles.saved }, t("card.saved")) : null),
        React.createElement("div", { style: styles.row },
          React.createElement("button", {
            style: styles.testBtn,
            onClick: testConnection,
            disabled: testing,
          }, testing ? t("card.testing") : t("card.test")),
          testMsg
            ? React.createElement("span", { style: styles.statusErr }, testMsg)
            : (lastTest && lastTest.at > 0
                ? React.createElement("span", { style: lastTest.ok === true ? styles.statusOk : styles.statusErr },
                    (lastTest.ok === true ? t("card.test.ok") : t("card.test.fail")) +
                    (lastTest.ok === true
                      ? " · " + lastTest.latencyMs + "ms · " + t("card.test.tools").replace("{n}", String(lastTest.tools))
                      : (lastTest.error ? " — " + lastTest.error : "")))
                : React.createElement("span", { style: styles.hint }, t("card.test.never")))),

        React.createElement("div", { style: styles.section }, t("card.perms")),
        PERMS.map(function (id) {
          return React.createElement("div", { key: id, style: styles.permRow },
            React.createElement("span", { style: styles.label }, t("card.perm." + id)),
            React.createElement("button", {
              style: Object.assign({}, styles.badge, perms[id] === true ? styles.on : styles.off),
              onClick: function () { togglePerm(id); },
            }, (perms[id] === true ? "ON " : "OFF ") + id));
        }),
        React.createElement("p", { style: styles.hint }, t("card.permConfirm")),

        React.createElement("p", { style: styles.note }, t("card.note")));
    }

    var name = "dsh-abap-mcp";
    var inject = ["slots", "locale", "settingsScope", "connection", "remote"];
    // 与 Host 侧一致的凭据引用名（SAP 密码）。
    var PASSWORD_REF = "SAP_PASSWORD";

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-abap-mcp: dictionaries");
      var t = ctx.locale.bind(NS);
      var scope = ctx.settingsScope.bind({ namespace: NS });
      var conn = ctx.get("connection");
      var api = conn && conn.api ? conn.api : null;
      var remote = ctx.get("remote") || null;
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "abap-mcp",
          order: 35,
          label: function () { return t("card.title"); }
        }, function () {
          return React.createElement(AbapMcpCard, {
            t: t,
            scope: scope,
            api: api,
            remote: remote,
            passwordRef: PASSWORD_REF
          });
        });
      });
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
