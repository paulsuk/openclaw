import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRunner } from "../../src/plugins/hooks.js";
import { addTestHook, TEST_PLUGIN_AGENT_CTX } from "../../src/plugins/hooks.test-helpers.js";
import { createEmptyPluginRegistry } from "../../src/plugins/registry.js";
import type { PluginHookRegistration } from "../../src/plugins/types.js";
import * as guardrails from "./guardrails.js";

describe("assistant guardrail policy integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("preloads gmail docs through before_prompt_build", async () => {
    vi.spyOn(guardrails, "readTrustedDoc").mockImplementation((filePath: string) => {
      if (String(filePath).includes("services.md")) {
        return "services root";
      }
      return "gmail service doc";
    });

    const registry = createEmptyPluginRegistry();
    addTestHook({
      registry,
      pluginId: "assistant-guardrails",
      hookName: "before_prompt_build",
      handler: ((event, ctx) =>
        guardrails.buildServicePreload({
          event: event as Parameters<typeof guardrails.buildServicePreload>[0]["event"],
          ctx: ctx as Parameters<typeof guardrails.buildServicePreload>[0]["ctx"],
        })) as PluginHookRegistration["handler"],
    });

    const runner = createHookRunner(registry);
    const result = await runner.runBeforePromptBuild(
      { prompt: "check my gmail inbox", messages: [] },
      TEST_PLUGIN_AGENT_CTX,
    );

    expect(result?.prependContext).toContain("assistant-guardrails preload: services");
    expect(result?.prependContext).toContain("assistant-guardrails preload: gmail");
  });

  it("denies gmail send through before_tool_call", async () => {
    const registry = createEmptyPluginRegistry();
    addTestHook({
      registry,
      pluginId: "assistant-guardrails",
      hookName: "before_tool_call",
      handler: ((event, ctx) =>
        guardrails.buildToolDeny({
          event: event as Parameters<typeof guardrails.buildToolDeny>[0]["event"],
          ctx: ctx as Parameters<typeof guardrails.buildToolDeny>[0]["ctx"],
        })) as PluginHookRegistration["handler"],
    });

    const runner = createHookRunner(registry);
    const result = await runner.runBeforeToolCall(
      { toolName: "gmail", params: { action: "send" } },
      {
        toolName: "gmail",
        agentId: TEST_PLUGIN_AGENT_CTX.agentId,
        sessionKey: TEST_PLUGIN_AGENT_CTX.sessionKey,
      },
    );

    expect(result).toEqual({
      block: true,
      blockReason: "Sending email is forbidden by assistant policy",
    });
  });

  it("does not preload on ambiguous prompt through before_prompt_build", async () => {
    vi.spyOn(guardrails, "readTrustedDoc").mockReturnValue("unused");

    const registry = createEmptyPluginRegistry();
    addTestHook({
      registry,
      pluginId: "assistant-guardrails",
      hookName: "before_prompt_build",
      handler: ((event, ctx) =>
        guardrails.buildServicePreload({
          event: event as Parameters<typeof guardrails.buildServicePreload>[0]["event"],
          ctx: ctx as Parameters<typeof guardrails.buildServicePreload>[0]["ctx"],
        })) as PluginHookRegistration["handler"],
    });

    const runner = createHookRunner(registry);
    const result = await runner.runBeforePromptBuild(
      { prompt: "check gmail and notion", messages: [] },
      TEST_PLUGIN_AGENT_CTX,
    );

    expect(result).toBeUndefined();
  });
});
