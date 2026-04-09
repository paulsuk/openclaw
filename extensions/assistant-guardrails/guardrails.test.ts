import { beforeEach, describe, expect, it, vi } from "vitest";
import * as guardrails from "./guardrails.js";

const { buildServicePreload, buildToolDeny, matchServiceFromPrompt } = guardrails;

describe("assistant guardrail policy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("matchServiceFromPrompt", () => {
    it("matches gmail explicitly", () => {
      expect(matchServiceFromPrompt("check my gmail unread inbox")).toBe("gmail");
    });

    it("matches notion explicitly", () => {
      expect(matchServiceFromPrompt("search notion for my notes")).toBe("notion");
    });

    it("fails closed on ambiguity", () => {
      expect(matchServiceFromPrompt("check gmail and notion")).toBeNull();
    });
  });

  describe("buildServicePreload", () => {
    it("returns preload context for a gmail prompt", () => {
      vi.spyOn(guardrails, "readTrustedDoc").mockImplementation((filePath: string) => {
        if (String(filePath).includes("services.md")) {
          return "services root";
        }
        return "gmail service doc";
      });

      const result = buildServicePreload({
        event: {
          prompt: "check my gmail inbox",
          messages: [],
        },
      });
      expect(result?.prependContext).toContain("assistant-guardrails preload: services");
      expect(result?.prependContext).toContain("assistant-guardrails preload: gmail");
    });

    it("returns undefined for ambiguous service prompts", () => {
      vi.spyOn(guardrails, "readTrustedDoc").mockReturnValue("unused");

      const result = buildServicePreload({
        event: {
          prompt: "check gmail and notion",
          messages: [],
        },
      });
      expect(result).toBeUndefined();
    });
  });

  describe("buildToolDeny", () => {
    it("denies gmail send", () => {
      const result = buildToolDeny({
        event: {
          toolName: "gmail",
          params: { action: "send" },
        },
      });
      expect(result).toEqual({
        block: true,
        blockReason: "Sending email is forbidden by assistant policy",
      });
    });

    it("denies gmail drafts send", () => {
      const result = buildToolDeny({
        event: {
          toolName: "gog",
          params: { command: "drafts.send" },
        },
      });
      expect(result).toEqual({
        block: true,
        blockReason: "Gmail draft sending is forbidden by assistant policy",
      });
    });

    it("denies notion writes", () => {
      const result = buildToolDeny({
        event: {
          toolName: "notion",
          params: { action: "create" },
        },
      });
      expect(result).toEqual({
        block: true,
        blockReason: "Notion is read-only by assistant policy",
      });
    });

    it("does not block read-only notion use", () => {
      const result = buildToolDeny({
        event: {
          toolName: "notion",
          params: { action: "search" },
        },
      });
      expect(result).toBeUndefined();
    });
  });
});
