import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";
import * as guardrails from "./guardrails.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

function createApi() {
  const hooks: Array<{ name: string; handler: (...args: unknown[]) => unknown }> = [];
  const api = {
    on(name: string, handler: (...args: unknown[]) => unknown) {
      hooks.push({ name, handler });
    },
  } as unknown as OpenClawPluginApi;
  return { api, hooks };
}

describe("assistant-guardrails plugin entry", () => {
  it("registers before_prompt_build and before_tool_call hooks", () => {
    const { api, hooks } = createApi();
    plugin.register(api);

    expect(hooks.map((hook) => hook.name)).toContain("before_prompt_build");
    expect(hooks.map((hook) => hook.name)).toContain("before_tool_call");
  });

  it("delegates prompt preload to guardrail policy", () => {
    const preloadSpy = vi.spyOn(guardrails, "buildServicePreload").mockReturnValue({
      prependContext: "preloaded",
    });
    const { api, hooks } = createApi();
    plugin.register(api);

    const hook = hooks.find((entry) => entry.name === "before_prompt_build");
    const result = hook?.handler({ prompt: "check gmail", messages: [] }, { sessionKey: "s" });

    expect(preloadSpy).toHaveBeenCalled();
    expect(result).toEqual({ prependContext: "preloaded" });
  });

  it("delegates tool deny to guardrail policy", () => {
    const denySpy = vi.spyOn(guardrails, "buildToolDeny").mockReturnValue({
      block: true,
      blockReason: "blocked",
    });
    const { api, hooks } = createApi();
    plugin.register(api);

    const hook = hooks.find((entry) => entry.name === "before_tool_call");
    const result = hook?.handler({ toolName: "gmail", params: { action: "send" } }, { toolName: "gmail" });

    expect(denySpy).toHaveBeenCalled();
    expect(result).toEqual({ block: true, blockReason: "blocked" });
  });
});
