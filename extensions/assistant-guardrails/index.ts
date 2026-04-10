import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  buildFileWriteGuardrail,
  buildServicePreload,
  buildToolDeny,
  buildWritePolicyReminder,
  cacheWorkspaceDir,
} from "./guardrails.js";

export default definePluginEntry({
  id: "assistant-guardrails",
  name: "Assistant Guardrails",
  description: "Prompt preload and hard-deny guardrails for assistant runtime",
  register(api: OpenClawPluginApi) {
    api.on("before_prompt_build", (event, ctx) => {
      cacheWorkspaceDir(ctx);
      const policyReminder = buildWritePolicyReminder();
      const servicePreload = buildServicePreload({ event, ctx });
      if (servicePreload) {
        return {
          prependContext: `${policyReminder.prependContext}\n\n${servicePreload.prependContext}`,
        };
      }
      return policyReminder;
    });
    api.on("before_tool_call", (event, ctx) => {
      return buildToolDeny({ event, ctx }) ?? buildFileWriteGuardrail({ event, ctx });
    });
  },
});
