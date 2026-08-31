// Permission model for dsh-abap-mcp.
//
// DEFAULT: everything off except a curated read-only allowlist. The server
// starts in strict read-only mode unless optional categories are enabled.
//
// Enable categories through the MCP_ABAP_PERMISSIONS environment variable — a
// JSON object, e.g. {"sourceWrite":true,"git":true}. Unknown keys and
// non-boolean values are ignored (with a warning). Any tool not listed here is
// denied by default (deny-by-default), so a new handler can never slip through.
//
// Dev/test usage is a *recommendation*, not an enforcement: we only log a
// warning at startup. Nothing here checks the SAP system you point at.

export type PermissionCategory =
  | 'sourceWrite' // create / edit / delete / activate / lock ABAP objects
  | 'transports'  // create / release / delete / configure transport requests
  | 'refactor'    // rename-execute, extract-method, pretty-printer
  | 'exec'        // run classes, unit tests, ATC runs, trace config
  | 'git'         // git create / pull / stage / push / branch switch
  | 'debug'       // debugger: breakpoints, step, attach, variable write
  | 'serviceBinding'; // publish / unpublish service bindings

export const CATEGORIES: readonly PermissionCategory[] = [
  'sourceWrite',
  'transports',
  'refactor',
  'exec',
  'git',
  'debug',
  'serviceBinding',
];

// Tools that are always available (the read-only core).
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  // auth / session
  'login',
  'logout',
  'dropSession',
  // object discovery
  'objectStructure',
  'searchObject',
  'findObjectPath',
  'objectTypes',
  'reentranceTicket',
  // class introspection
  'classIncludes',
  'classComponents',
  // code analysis (read-only)
  'syntaxCheckCode',
  'syntaxCheckCdsUrl',
  'codeCompletion',
  'findDefinition',
  'usageReferences',
  'syntaxCheckTypes',
  'codeCompletionFull',
  'codeCompletionElement',
  'usageReferenceSnippets',
  'fixProposals',
  'fixEdits',
  'fragmentMappings',
  'abapDocumentation',
  // source reading
  'getObjectSource',
  // inactive-object listing
  'inactiveObjects',
  // object registration info / validation
  'objectRegistrationInfo',
  'validateNewObject',
  // transport reading
  'transportInfo',
  'hasTransportConfig',
  'transportConfigurations',
  'getTransportConfiguration',
  'userTransports',
  'transportsByConfig',
  'systemUsers',
  'transportReference',
  // repository node browsing
  'nodeContents',
  'mainPrograms',
  // feature / discovery
  'featureDetails',
  'collectionFeatureDetails',
  'findCollectionByUrl',
  'loadTypes',
  'adtDiscovery',
  'adtCoreDiscovery',
  'adtCompatibiliyGraph',
  // unit-test result evaluation (read-only)
  'unitTestEvaluation',
  'unitTestOccurrenceMarkers',
  // pretty-printer setting (read)
  'prettyPrinterSetting',
  // git reading
  'gitRepos',
  'gitExternalRepoInfo',
  'checkRepo',
  'remoteRepoInfo',
  // DDIC reading
  'annotationDefinitions',
  'ddicElement',
  'ddicRepositoryAccess',
  'packageSearchHelp',
  // service-binding details (read)
  'bindingDetails',
  // data reading
  'tableContents',
  'runQuery',
  // feeds / dumps
  'feeds',
  'dumps',
  // rename analysis (read-only preview)
  'renameEvaluate',
  'renamePreview',
  // ATC reading
  'atcCustomizing',
  'atcCheckVariant',
  'atcWorklists',
  'atcUsers',
  'isProposalMessage',
  'atcContactUri',
  // trace reading
  'tracesList',
  'tracesListRequests',
  'tracesHitList',
  'tracesDbAccess',
  'tracesStatements',
  // revisions & health
  'revisions',
  'healthcheck',
  // source grep (read-only, client-side regex over fetched sources)
  'grepObjects',
  'grepPackages',
  // system info (read-only, from T000/CVERS)
  'getSystemInfo',
  'getInstalledComponents',
]);

// Tools gated behind each optional category.
export const CATEGORY_TOOLS: Record<PermissionCategory, ReadonlySet<string>> = {
  sourceWrite: new Set([
    'setObjectSource',
    'deleteObject',
    'activateObjects',
    'activateByName',
    'createObject',
    'createTestInclude',
    'lock',
    'unLock',
  ]),
  transports: new Set([
    'createTransport',
    'setTransportsConfig',
    'createTransportsConfig',
    'transportDelete',
    'transportRelease',
    'transportSetOwner',
    'transportAddUser',
  ]),
  refactor: new Set([
    'renameExecute',
    'extractMethodEvaluate',
    'extractMethodPreview',
    'extractMethodExecute',
    'prettyPrinter',
    'setPrettyPrinterSetting',
  ]),
  exec: new Set([
    'runClass',
    'unitTestRun',
    'createAtcRun',
    'atcExemptProposal',
    'atcRequestExemption',
    'atcChangeContact',
    'tracesSetParameters',
    'tracesCreateConfiguration',
    'tracesDeleteConfiguration',
    'tracesDelete',
  ]),
  git: new Set([
    'gitCreateRepo',
    'gitPullRepo',
    'gitUnlinkRepo',
    'stageRepo',
    'pushRepo',
    'switchRepoBranch',
  ]),
  debug: new Set([
    'debuggerListeners',
    'debuggerListen',
    'debuggerDeleteListener',
    'debuggerSetBreakpoints',
    'debuggerDeleteBreakpoints',
    'debuggerAttach',
    'debuggerSaveSettings',
    'debuggerStackTrace',
    'debuggerVariables',
    'debuggerChildVariables',
    'debuggerStep',
    'debuggerGoToStack',
    'debuggerSetVariableValue',
  ]),
  serviceBinding: new Set([
    'publishServiceBinding',
    'unPublishServiceBinding',
  ]),
};

const ALL_KNOWN = new Set<string>(READ_ONLY_TOOLS);
for (const cat of CATEGORIES) {
  for (const t of CATEGORY_TOOLS[cat]) ALL_KNOWN.add(t);
}

export class Permissions {
  readonly enabledCategories: Set<PermissionCategory> = new Set();
  readonly enabledTools: Set<string> = new Set(READ_ONLY_TOOLS);

  constructor(raw: string | undefined) {
    if (!raw) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error(
        '[dsh-abap-mcp] MCP_ABAP_PERMISSIONS is not valid JSON — falling back to read-only mode.',
        (e as Error).message
      );
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.error(
        '[dsh-abap-mcp] MCP_ABAP_PERMISSIONS must be a JSON object — falling back to read-only mode.'
      );
      return;
    }
    for (const cat of CATEGORIES) {
      const v = (parsed as Record<string, unknown>)[cat];
      if (v === true) {
        this.enabledCategories.add(cat);
        for (const t of CATEGORY_TOOLS[cat]) this.enabledTools.add(t);
      } else if (v !== undefined && v !== false) {
        console.error(
          `[dsh-abap-mcp] Ignoring non-boolean value for permission '${cat}': ${String(v)}`
        );
      }
    }
  }

  isEnabled(tool: string): boolean {
    return this.enabledTools.has(tool);
  }

  isKnown(tool: string): boolean {
    return ALL_KNOWN.has(tool);
  }

  isReadOnly(): boolean {
    return this.enabledCategories.size === 0;
  }

  categoryOf(tool: string): PermissionCategory | null {
    if (READ_ONLY_TOOLS.has(tool)) return null;
    for (const cat of CATEGORIES) {
      if (CATEGORY_TOOLS[cat].has(tool)) return cat;
    }
    return null;
  }

  describe(): string {
    if (this.isReadOnly()) {
      return 'read-only (all write categories disabled)';
    }
    return `read-only + [${[...this.enabledCategories].join(', ')}]`;
  }
}

export function loadPermissions(): Permissions {
  return new Permissions(process.env.MCP_ABAP_PERMISSIONS);
}
