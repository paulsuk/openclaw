import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  PluginHookAgentContext,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforeToolCallEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/plugin-entry";

const log = {
  debug(message: string) {
    console.debug(message);
  },
  warn(message: string) {
    console.warn(message);
  },
};

const TRUSTED_BASE_SEGMENTS = ["gdrive_sync", "projects", "_assistant"] as const;

const SERVICES_DOC_SEGMENTS = ["docs", "services.md"] as const;

const SERVICE_DOC_SEGMENTS = {
  calendar: ["services", "google-calendar.md"],
  todoist: ["services", "todoist.md"],
  gmail: ["services", "gmail.md"],
  notion: ["services", "notion.md"],
  "google-docs": ["services", "google-docs.md"],
  "web-research": ["services", "web-research.md"],
} as const;

const MAX_PRELOAD_BYTES = 24 * 1024;

type ServiceId = keyof typeof SERVICE_DOC_SEGMENTS;

const SERVICE_MATCHERS: Array<{ service: ServiceId; patterns: RegExp[] }> = [
  { service: "calendar", patterns: [/(^|\b)(calendar|event|freebusy|schedule)(\b|$)/i] },
  { service: "todoist", patterns: [/(^|\b)(todoist|to-do|todo|task|tasks)(\b|$)/i] },
  { service: "gmail", patterns: [/(^|\b)(gmail|email|inbox|unread mail)(\b|$)/i] },
  { service: "notion", patterns: [/(^|\b)(notion)(\b|$)/i] },
  {
    service: "google-docs",
    patterns: [/(^|\b)(google doc|google docs|docs|drive document)(\b|$)/i],
  },
  {
    service: "web-research",
    patterns: [/(search the web|web research|look this up online)/i],
  },
];

function normalizePromptText(event: PluginHookBeforePromptBuildEvent): string {
  const messageText = event.messages
    .map((msg) => {
      if (typeof msg === "string") {
        return msg;
      }
      if (msg && typeof msg === "object") {
        const record = msg as Record<string, unknown>;
        const content = record.content;
        if (typeof content === "string") {
          return content;
        }
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
  return [event.prompt, messageText].filter(Boolean).join("\n\n");
}

export function matchServiceFromPrompt(text: string): ServiceId | null {
  const hits = SERVICE_MATCHERS.filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)));
  if (hits.length !== 1) {
    return null;
  }
  return hits[0]?.service ?? null;
}

export function resolveTrustedBase(ctx?: PluginHookAgentContext): string {
  const workspaceDir = ctx?.workspaceDir?.trim();
  return workspaceDir
    ? path.resolve(workspaceDir, ...TRUSTED_BASE_SEGMENTS)
    : path.resolve(...TRUSTED_BASE_SEGMENTS);
}

export function resolveTrustedDocPath(
  relativeSegments: readonly string[],
  ctx?: PluginHookAgentContext,
): string {
  return path.join(resolveTrustedBase(ctx), ...relativeSegments);
}

export function readTrustedDoc(filePath: string, ctx?: PluginHookAgentContext): string | null {
  const trustedBase = resolveTrustedBase(ctx);
  const resolved = path.resolve(filePath);
  const relative = path.relative(trustedBase, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    log.warn(
      `[assistant-guardrails] preload skip ${JSON.stringify({ reason: "untrusted_path", path: resolved, trusted_base: trustedBase })}`,
    );
    return null;
  }
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      log.warn(
        `[assistant-guardrails] preload skip ${JSON.stringify({ reason: "not_file", path: resolved })}`,
      );
      return null;
    }
    if (stat.size > MAX_PRELOAD_BYTES) {
      log.warn(
        `[assistant-guardrails] preload skip ${JSON.stringify({ reason: "oversize", path: resolved, size: stat.size })}`,
      );
      return null;
    }
    return fs.readFileSync(resolved, "utf8");
  } catch (error) {
    log.warn(
      `[assistant-guardrails] preload skip ${JSON.stringify({ reason: "read_failed", path: resolved, error: String(error) })}`,
    );
    return null;
  }
}

export function buildServicePreload(params: {
  event: PluginHookBeforePromptBuildEvent;
  ctx?: PluginHookAgentContext;
}): { prependContext: string } | undefined {
  const promptText = normalizePromptText(params.event);
  const matchedService = matchServiceFromPrompt(promptText);
  if (!matchedService) {
    log.debug(
      `[assistant-guardrails] preload ${JSON.stringify({ hook: "before_prompt_build", action: "preload_service_docs", matched_service: null, skipped: true, skip_reason: "no_unique_service_match" })}`,
    );
    return undefined;
  }

  const servicesDocPath = resolveTrustedDocPath(SERVICES_DOC_SEGMENTS, params.ctx);
  const serviceDocPath = resolveTrustedDocPath(SERVICE_DOC_SEGMENTS[matchedService], params.ctx);
  const servicesDoc = readTrustedDoc(servicesDocPath, params.ctx);
  const serviceDoc = readTrustedDoc(serviceDocPath, params.ctx);
  if (!servicesDoc || !serviceDoc) {
    log.warn(
      `[assistant-guardrails] preload ${JSON.stringify({ hook: "before_prompt_build", action: "preload_service_docs", matched_service: matchedService, skipped: true, skip_reason: "preload_read_failed" })}`,
    );
    return undefined;
  }

  log.debug(
    `[assistant-guardrails] preload ${JSON.stringify({ hook: "before_prompt_build", action: "preload_service_docs", matched_service: matchedService, injected_paths: [servicesDocPath, serviceDocPath], skipped: false })}`,
  );

  return {
    prependContext: [
      `[assistant-guardrails preload: services]\n${servicesDoc}`,
      `[assistant-guardrails preload: ${matchedService}]\n${serviceDoc}`,
    ].join("\n\n"),
  };
}

// ---------------------------------------------------------------------------
// Workspace dir cache
// PluginHookToolContext does not carry workspaceDir; we capture it from
// before_prompt_build (which always fires before any tool calls in a session).
// ---------------------------------------------------------------------------

let _cachedWorkspaceDir: string | undefined;

export function cacheWorkspaceDir(ctx?: PluginHookAgentContext): void {
  const dir = ctx?.workspaceDir?.trim();
  if (dir) {
    _cachedWorkspaceDir = dir;
  }
}

/** Reset the workspace cache. Only for use in tests. */
export function _resetWorkspaceDirCache(): void {
  _cachedWorkspaceDir = undefined;
}

// ---------------------------------------------------------------------------
// File-write location guardrail
// ---------------------------------------------------------------------------

const SYSTEM_TEMP_ROOTS: readonly string[] = [
  ...new Set([os.tmpdir(), "/tmp", "/var/tmp"].map((p) => path.resolve(p))),
];

function isTempPath(resolvedPath: string): boolean {
  return SYSTEM_TEMP_ROOTS.some(
    (tmp) => resolvedPath === tmp || resolvedPath.startsWith(tmp + path.sep),
  );
}

// Cache git-root lookups: maps a directory path → whether it is inside a git repo.
// Avoids re-walking the FS when the agent writes multiple files to the same repo.
const gitRootCache = new Map<string, boolean>();

export function isUnderGitRepo(filePath: string): boolean {
  let dir: string;
  try {
    const stat = fs.statSync(filePath);
    dir = stat.isDirectory() ? filePath : path.dirname(filePath);
  } catch {
    // File doesn't exist yet (being created) — check parent
    dir = path.dirname(path.resolve(filePath));
  }

  if (gitRootCache.has(dir)) {
    return gitRootCache.get(dir)!;
  }

  const visited: string[] = [];
  let prev = "";
  let found = false;

  while (dir !== prev) {
    if (gitRootCache.has(dir)) {
      found = gitRootCache.get(dir)!;
      break;
    }
    visited.push(dir);
    try {
      if (fs.existsSync(path.join(dir, ".git"))) {
        found = true;
        break;
      }
    } catch {
      // ignore FS errors during walk
    }
    prev = dir;
    dir = path.dirname(dir);
  }

  // Populate cache for every directory we visited
  for (const visitedDir of visited) {
    gitRootCache.set(visitedDir, found);
  }

  return found;
}

export function isApprovedWritePath(filePath: string): boolean {
  const resolved = path.resolve(filePath);

  if (isTempPath(resolved)) return true;

  // Allow anywhere within the workspace (DUM-E's private space, includes gdrive_sync and exchange)
  const workspace = _cachedWorkspaceDir;
  if (workspace) {
    const ws = path.resolve(workspace);
    if (resolved === ws || resolved.startsWith(ws + path.sep)) return true;
  }

  // Allow git repos (version-controlled work, including repos outside the workspace)
  if (isUnderGitRepo(resolved)) return true;

  return false;
}

function extractWritePath(event: PluginHookBeforeToolCallEvent): string | null {
  const name = event.toolName.toLowerCase();
  if (name === "write" || name === "edit" || name === "multiedit") {
    const filePath = event.params.file_path;
    return typeof filePath === "string" ? filePath : null;
  }
  return null;
}

// Kept intentionally compact — this is injected on every LLM call.
const WRITE_POLICY_REMINDER =
  "[policy] File writes allowed in: workspace/**, git repos, /tmp only. Blocked elsewhere — use exchange/ or gdrive_sync/.";

export function buildWritePolicyReminder(): { prependContext: string } {
  return { prependContext: WRITE_POLICY_REMINDER };
}

export function buildFileWriteGuardrail(params: {
  event: PluginHookBeforeToolCallEvent;
  ctx?: PluginHookToolContext;
}): { block: true; blockReason: string } | undefined {
  const filePath = extractWritePath(params.event);
  if (!filePath) return undefined;

  if (isApprovedWritePath(filePath)) return undefined;

  const reason = `File write to '${filePath}' is outside approved locations (gdrive_sync, exchange, or a git repo). Move work to a tracked location.`;

  log.warn(
    `[assistant-guardrails] deny ${JSON.stringify({
      hook: "before_tool_call",
      action: "deny_file_write",
      tool_name: params.event.toolName,
      matched_rule: "file-write-location-deny",
      file_path: filePath,
      deny_reason: reason,
    })}`,
  );

  return { block: true, blockReason: reason };
}

function isGmailSend(event: PluginHookBeforeToolCallEvent): boolean {
  const name = event.toolName.toLowerCase();
  if (!name.includes("gmail") && !name.includes("gog")) {
    return false;
  }
  const action = typeof event.params.action === "string" ? event.params.action.toLowerCase() : "";
  const command = typeof event.params.command === "string" ? event.params.command.toLowerCase() : "";
  const subcommand = typeof event.params.subcommand === "string" ? event.params.subcommand.toLowerCase() : "";
  return [action, command, subcommand].some((value) => value === "send" || value === "drafts.send");
}

function isGmailDraftsSend(event: PluginHookBeforeToolCallEvent): boolean {
  const name = event.toolName.toLowerCase();
  if (!name.includes("gmail") && !name.includes("gog")) {
    return false;
  }
  const action = typeof event.params.action === "string" ? event.params.action.toLowerCase() : "";
  const command = typeof event.params.command === "string" ? event.params.command.toLowerCase() : "";
  const subcommand = typeof event.params.subcommand === "string" ? event.params.subcommand.toLowerCase() : "";
  return [action, command, subcommand].includes("drafts.send");
}

function isNotionWrite(event: PluginHookBeforeToolCallEvent): boolean {
  const name = event.toolName.toLowerCase();
  if (!name.includes("notion")) {
    return false;
  }
  const action = typeof event.params.action === "string" ? event.params.action.toLowerCase() : "";
  const operation = typeof event.params.operation === "string" ? event.params.operation.toLowerCase() : "";
  const command = typeof event.params.command === "string" ? event.params.command.toLowerCase() : "";
  const mutating = new Set(["create", "update", "delete", "append", "edit", "write", "archive"]);
  return [action, operation, command].some((value) => mutating.has(value));
}

export function buildToolDeny(params: {
  event: PluginHookBeforeToolCallEvent;
  ctx?: PluginHookToolContext;
}): { block: true; blockReason: string } | undefined {
  let matchedRule: string | null = null;
  let denyReason: string | null = null;

  if (isGmailDraftsSend(params.event)) {
    matchedRule = "gmail-drafts-send-deny";
    denyReason = "Gmail draft sending is forbidden by assistant policy";
  } else if (isGmailSend(params.event)) {
    matchedRule = "gmail-send-deny";
    denyReason = "Sending email is forbidden by assistant policy";
  } else if (isNotionWrite(params.event)) {
    matchedRule = "notion-write-deny";
    denyReason = "Notion is read-only by assistant policy";
  }

  if (!matchedRule || !denyReason) {
    return undefined;
  }

  log.warn(
    `[assistant-guardrails] deny ${JSON.stringify({ hook: "before_tool_call", action: "deny_tool_call", tool_name: params.event.toolName, matched_rule: matchedRule, deny_reason: denyReason })}`,
  );

  return {
    block: true,
    blockReason: denyReason,
  };
}
