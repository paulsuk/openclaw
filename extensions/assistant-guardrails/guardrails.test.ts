import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as guardrails from "./guardrails.js";

const {
  buildFileWriteGuardrail,
  buildServicePreload,
  buildToolDeny,
  cacheWorkspaceDir,
  isApprovedWritePath,
  isUnderGitRepo,
  matchServiceFromPrompt,
  resolveTrustedBase,
  resolveTrustedDocPath,
  _resetWorkspaceDirCache,
} = guardrails;

describe("assistant guardrail policy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetWorkspaceDirCache();
  });

  afterEach(() => {
    _resetWorkspaceDirCache();
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

  describe("isUnderGitRepo", () => {
    // Normalize path separators for cross-platform mock comparisons
    function normalizeSep(p: string): string {
      return p.replace(/\\/g, "/");
    }

    it("returns true when a .git dir exists in a parent", () => {
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const n = normalizeSep(String(p));
        return n.endsWith("/.git") && n.includes("/repos/myrepo");
      });

      expect(isUnderGitRepo("/workspace/shared/repos/myrepo/src/file.ts")).toBe(true);
    });

    it("returns false when no .git dir exists up the tree", () => {
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      expect(isUnderGitRepo("/workspace/shared/random/file.ts")).toBe(false);
    });

    it("handles non-existent file by checking parent directory", () => {
      vi.spyOn(fs, "statSync").mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const n = normalizeSep(String(p));
        return n.endsWith("/repos/myrepo/.git");
      });

      expect(isUnderGitRepo("/workspace/shared/repos/myrepo/newfile.ts")).toBe(true);
    });
  });

  describe("isApprovedWritePath", () => {
    // Normalize path separators for cross-platform mock comparisons
    function normalizeSep(p: string): string {
      return p.replace(/\\/g, "/");
    }

    it("allows writes inside gdrive_sync when workspace is cached", () => {
      cacheWorkspaceDir({ workspaceDir: "/workspace/shared" });
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      expect(isApprovedWritePath("/workspace/shared/gdrive_sync/projects/_assistant/notes.md")).toBe(
        true,
      );
    });

    it("allows writes inside exchange when workspace is cached", () => {
      cacheWorkspaceDir({ workspaceDir: "/workspace/shared" });
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      expect(isApprovedWritePath("/workspace/shared/exchange/output.txt")).toBe(true);
    });

    it("allows writes anywhere in workspace (memory, root docs, etc.)", () => {
      cacheWorkspaceDir({ workspaceDir: "/workspace/shared" });
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      expect(isApprovedWritePath("/workspace/shared/AGENTS.md")).toBe(true);
      expect(isApprovedWritePath("/workspace/shared/memory/session.md")).toBe(true);
    });

    it("allows writes inside a git repo", () => {
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const n = normalizeSep(String(p));
        return n.endsWith("/repos/ResyBot/.git");
      });

      expect(isApprovedWritePath("/workspace/shared/repos/ResyBot/src/bot.py")).toBe(true);
    });

    it("allows writes to temp paths", () => {
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      expect(isApprovedWritePath("/tmp/scratch.txt")).toBe(true);
    });

    it("blocks writes outside workspace and git repos", () => {
      cacheWorkspaceDir({ workspaceDir: "/workspace/shared" });
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      expect(isApprovedWritePath("/home/user/random/file.txt")).toBe(false);
      expect(isApprovedWritePath("/etc/someconfig")).toBe(false);
    });
  });

  describe("buildFileWriteGuardrail", () => {
    // Normalize path separators for cross-platform mock comparisons
    function normalizeSep(p: string): string {
      return p.replace(/\\/g, "/");
    }

    it("blocks a Write tool call to a path outside workspace and git repos", () => {
      cacheWorkspaceDir({ workspaceDir: "/workspace/shared" });
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const result = buildFileWriteGuardrail({
        event: { toolName: "Write", params: { file_path: "/home/user/random/file.txt" } },
      });
      expect(result).toEqual({
        block: true,
        blockReason: expect.stringContaining("outside approved locations"),
      });
    });

    it("blocks an Edit tool call to a path outside workspace", () => {
      cacheWorkspaceDir({ workspaceDir: "/workspace/shared" });
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const result = buildFileWriteGuardrail({
        event: {
          toolName: "Edit",
          params: { file_path: "/etc/hosts" },
        },
      });
      expect(result).toEqual({
        block: true,
        blockReason: expect.stringContaining("outside approved locations"),
      });
    });

    it("allows a Write tool call to gdrive_sync inside workspace", () => {
      cacheWorkspaceDir({ workspaceDir: "/workspace/shared" });
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const result = buildFileWriteGuardrail({
        event: {
          toolName: "Write",
          params: { file_path: "/workspace/shared/gdrive_sync/projects/_assistant/notes.md" },
        },
      });
      expect(result).toBeUndefined();
    });

    it("allows a Write tool call to workspace root", () => {
      cacheWorkspaceDir({ workspaceDir: "/workspace/shared" });
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const result = buildFileWriteGuardrail({
        event: {
          toolName: "Write",
          params: { file_path: "/workspace/shared/AGENTS.md" },
        },
      });
      expect(result).toBeUndefined();
    });

    it("allows a Write tool call inside a git repo", () => {
      vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => false } as fs.Stats));
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const n = normalizeSep(String(p));
        return n.endsWith("/repos/ResyBot/.git");
      });

      const result = buildFileWriteGuardrail({
        event: {
          toolName: "Write",
          params: { file_path: "/workspace/shared/repos/ResyBot/main.py" },
        },
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined for non-write tools (no file_path)", () => {
      const result = buildFileWriteGuardrail({
        event: { toolName: "gmail", params: { action: "read" } },
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined for Bash tool calls (not intercepted)", () => {
      const result = buildFileWriteGuardrail({
        event: { toolName: "Bash", params: { command: "echo hello > /tmp/x.txt" } },
      });
      expect(result).toBeUndefined();
    });
  });
});
