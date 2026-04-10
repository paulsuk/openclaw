import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as guardrails from "./guardrails.js";

const {
  buildServicePreload,
  buildToolDeny,
  matchServiceFromPrompt,
  resolveTrustedBase,
  resolveTrustedDocPath,
} = guardrails;

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

  describe("trusted path resolution", () => {
    it("resolves trusted base from runtime workspaceDir", () => {
      expect(resolveTrustedBase({ workspaceDir: "/workspace/shared" })).toBe(
        path.resolve("/workspace/shared", "gdrive_sync", "projects", "_assistant"),
      );
    });

    it("falls back to repo-relative logical path when workspaceDir is absent", () => {
      expect(resolveTrustedBase()).toContain("gdrive_sync");
      expect(resolveTrustedBase()).toContain("_assistant");
    });

    it("builds trusted doc paths under the resolved base", () => {
      expect(resolveTrustedDocPath(["services", "gmail.md"], { workspaceDir: "/workspace/shared" })).toBe(
        path.join(path.resolve("/workspace/shared", "gdrive_sync", "projects", "_assistant"), "services", "gmail.md"),
      );
    });
  });

  describe("buildServicePreload", () => {
    it("returns preload context for a gmail prompt", () => {
      vi.spyOn(fs, "statSync").mockImplementation((filePath: fs.PathLike) => {
        const file = String(filePath);
        return {
          isFile: () => file.includes("services.md") || file.includes("gmail.md"),
          size: 128,
        } as fs.Stats;
      });
      vi.spyOn(fs, "readFileSync").mockImplementation((filePath: fs.PathOrFileDescriptor) => {
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
        ctx: {
          workspaceDir: "/workspace/shared",
        },
      });
      expect(result?.prependContext).toContain("assistant-guardrails preload: services");
      expect(result?.prependContext).toContain("assistant-guardrails preload: gmail");
    });

    it("passes runtime-resolved doc paths into trusted reads", () => {
      vi.spyOn(fs, "statSync").mockImplementation(() => {
        return {
          isFile: () => true,
          size: 128,
        } as fs.Stats;
      });
      const readSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("doc" as never);

      buildServicePreload({
        event: {
          prompt: "check my gmail inbox",
          messages: [],
        },
        ctx: {
          workspaceDir: "/workspace/shared",
        },
      });

      expect(readSpy).toHaveBeenNthCalledWith(
        1,
        path.join(path.resolve("/workspace/shared", "gdrive_sync", "projects", "_assistant"), "docs", "services.md"),
        "utf8",
      );
      expect(readSpy).toHaveBeenNthCalledWith(
        2,
        path.join(path.resolve("/workspace/shared", "gdrive_sync", "projects", "_assistant"), "services", "gmail.md"),
        "utf8",
      );
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
