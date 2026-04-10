import fs from "node:fs";
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
