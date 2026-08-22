import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  buildPendantToolResultDetails,
  createMcpDirectToolCallRenderer,
  formatMcpDirectToolCallLines,
  formatMcpProxyToolCallLines,
  formatMcpResultTitle,
  formatMcpToolResultIdentity,
  formatMcpToolResultLines,
  renderMcpProxyToolCall,
  renderMcpToolResult,
} from "../tool-result-renderer.ts";

type TestDetails = Record<string, unknown> & { error?: unknown };
type TestResult = AgentToolResult<TestDetails>;

const collapsedOptions: ToolRenderResultOptions = { expanded: false, isPartial: false };
const plainTheme = { fg: (_name: string, text: string) => text };

function result(content: TestResult["content"], details: TestDetails = {}): TestResult {
  return { content, details };
}

describe("MCP tool call renderer", () => {
  it("shows proxy tool calls with parsed JSON arguments", () => {
    const display = formatMcpProxyToolCallLines({
      tool: "cf-portal_list_worker_tail_events",
      server: "cf-portal",
      args: JSON.stringify({ accountId: "abc", scriptName: "worker" }),
    });

    expect(display).toEqual([
      "mcp call cf-portal_list_worker_tail_events @ cf-portal",
      '{\n  "accountId": "abc",\n  "scriptName": "worker"\n}',
    ]);
  });

  it("shows proxy tool calls with native object arguments", () => {
    const display = formatMcpProxyToolCallLines({
      tool: "cf-portal_list_worker_tail_events",
      args: { accountId: "abc", limit: 10 },
    });

    expect(display).toEqual([
      "mcp call cf-portal_list_worker_tail_events",
      '{\n  "accountId": "abc",\n  "limit": 10\n}',
    ]);
  });

  it("shows proxy discovery operations", () => {
    expect(formatMcpProxyToolCallLines({ search: "tail events", server: "cf-portal", regex: true })).toEqual([
      "mcp search tail events @ cf-portal (regex)",
    ]);
    expect(formatMcpProxyToolCallLines({ connect: "cf-portal" })).toEqual(["mcp connect cf-portal"]);
    expect(formatMcpProxyToolCallLines({ server: "cf-portal" })).toEqual(["mcp list cf-portal"]);
    expect(formatMcpProxyToolCallLines({})).toEqual(["mcp status"]);
  });

  it("renders ui-messages with execution precedence", () => {
    expect(formatMcpProxyToolCallLines({ action: "ui-messages", server: "cf-portal" })).toEqual(["mcp ui-messages"]);
  });

  it("shows direct tool calls with JSON arguments", () => {
    const display = formatMcpDirectToolCallLines("cf-portal_list_worker_tail_events", {
      accountId: "abc",
      scriptName: "worker",
    });

    expect(display).toEqual([
      "cf-portal_list_worker_tail_events",
      '{\n  "accountId": "abc",\n  "scriptName": "worker"\n}',
    ]);
  });

  it("omits empty direct tool arguments", () => {
    expect(formatMcpDirectToolCallLines("cf-portal_status", {})).toEqual(["cf-portal_status"]);
  });
});

describe("MCP tool result renderer", () => {
  it("shows the first three lines and an ellipsis for collapsed long text", () => {
    const display = formatMcpToolResultLines(result([
      { type: "text", text: "one\ntwo\nthree\nfour" },
    ]), false);

    expect(display).toEqual({
      lines: ["one", "two", "three", "…"],
      truncated: true,
    });
  });

  it("does not add an ellipsis when collapsed text is three lines or fewer", () => {
    const display = formatMcpToolResultLines(result([
      { type: "text", text: "one\ntwo\nthree" },
    ]), false);

    expect(display).toEqual({
      lines: ["one", "two", "three"],
      truncated: false,
    });
  });

  it("shows full text when expanded", () => {
    const display = formatMcpToolResultLines(result([
      { type: "text", text: "one\ntwo\nthree\nfour" },
    ]), true);

    expect(display).toEqual({
      lines: ["one", "two", "three", "four"],
      truncated: false,
    });
  });

  it("uses placeholders for images", () => {
    const display = formatMcpToolResultLines(result([
      { type: "text", text: "before" },
      { type: "image", mimeType: "image/png", data: "abc" },
    ]), true);

    expect(display.lines).toEqual(["before", "[image: image/png]"]);
  });

  it("uses an empty-result placeholder when content is empty", () => {
    const display = formatMcpToolResultLines(result([]), false);

    expect(display).toEqual({ lines: ["(empty result)"], truncated: false });
  });

  it("keeps error text visible", () => {
    const display = formatMcpToolResultLines(result([
      { type: "text", text: "Error: upstream failed\nExpected parameters:\n{}" },
    ]), false);

    expect(display.lines).toEqual(["Error: upstream failed", "Expected parameters:", "{}"]);
    expect(display.truncated).toBe(false);
  });

  it("formats proxy call result identity from details", () => {
    expect(formatMcpToolResultIdentity({ mode: "call", server: "figma", tool: "get_nodes" })).toBe("MCP figma/get_nodes");
    expect(formatMcpToolResultIdentity({ mode: "call", server: "files", resourceUri: "file://demo" })).toBe("MCP files resource file://demo");
    expect(formatMcpToolResultIdentity({ mode: "call", server: "figma", requestedTool: "figma_get_nodes" })).toBe("MCP figma/figma_get_nodes");
    expect(formatMcpToolResultIdentity({ mode: "call", hintServer: "figma", requestedTool: "figma_get_nodes" })).toBe("MCP figma/figma_get_nodes");
    expect(formatMcpToolResultIdentity({ mode: "list", server: "figma", tool: "get_nodes" })).toBeNull();
  });

  it("collapses a single line that wraps beyond the compact viewport height", () => {
    const output = renderMcpToolResult(
      result([{
        type: "text",
        text: "segment-1 segment-2 segment-3 segment-4 segment-5 segment-6 segment-7 segment-8",
      }]),
      collapsedOptions,
      plainTheme,
      { isError: false },
    ).render(20).join("\n");

    expect(output).toContain("segment-1");
    expect(output).toContain("…");
    expect(output).toContain("Ctrl+O to expand");
    expect(output).not.toContain("segment-8");
  });

  it("bounds a huge single-line collapsed result and shows the expand hint", () => {
    const huge = `head ${"x".repeat(50_000)} tail-marker`;
    const output = renderMcpToolResult(
      result([{ type: "text", text: huge }]),
      collapsedOptions,
      plainTheme,
      { isError: false },
    ).render(80).join("\n");

    expect(output).toContain("head");
    expect(output).toContain("Ctrl+O to expand");
    expect(output).not.toContain("tail-marker");
  });

  it("reuses truncated collapsed lines at the same width", () => {
    const renderer = renderMcpToolResult(
      result([{ type: "text", text: "one\ntwo\nthree\nfour" }]),
      collapsedOptions,
      plainTheme,
      { isError: false },
    );

    const first = renderer.render(80);
    const second = renderer.render(80);
    expect(second).toBe(first);
    expect(second.join("\n")).toContain("Ctrl+O to expand");
  });

  it("shows proxy call result identity without hiding the third content line", () => {
    const output = renderMcpToolResult(
      result([{ type: "text", text: "one\ntwo\nthree\nfour" }], { mode: "call", server: "figma", tool: "get_nodes" }),
      collapsedOptions,
      plainTheme,
      { isError: false },
    ).render(80).join("\n");

    expect(output).toContain("MCP figma/get_nodes");
    expect(output).toContain("one");
    expect(output).toContain("two");
    expect(output).toContain("three");
    expect(output).not.toContain("four");
    expect(output).toContain("Ctrl+O to expand");
  });

  it("shows the full wrapped single line when expanded", () => {
    const output = renderMcpToolResult(
      result([{
        type: "text",
        text: "segment-1 segment-2 segment-3 segment-4 segment-5 segment-6 segment-7 segment-8",
      }]),
      { expanded: true, isPartial: false },
      plainTheme,
      { isError: false },
    ).render(20).join("\n");

    expect(output).toContain("segment-8");
    expect(output).not.toContain("Ctrl+O to expand");
  });

  it("renders long error results expanded even when the row is collapsed", () => {
    const output = renderMcpToolResult(
      result([{ type: "text", text: "Error: failed\nline 2\nline 3\nline 4" }]),
      collapsedOptions,
      plainTheme,
      { isError: true },
    ).render(80).join("\n");

    expect(output).toContain("line 4");
    expect(output).not.toContain("Ctrl+O to expand");
    expect(output).not.toContain("…");
  });

  it("does not collapse a long single-line error", () => {
    const output = renderMcpToolResult(
      result([{
        type: "text",
        text: "Error: segment-1 segment-2 segment-3 segment-4 segment-5 segment-6 segment-7 segment-8",
      }]),
      collapsedOptions,
      plainTheme,
      { isError: true },
    ).render(20).join("\n");

    expect(output).toContain("segment-8");
    expect(output).not.toContain("Ctrl+O to expand");
  });

  it("renders adapter error details expanded even when Pi context is not marked as an error", () => {
    const output = renderMcpToolResult(
      result([{ type: "text", text: "Error: failed\nline 2\nline 3\nline 4" }], { error: "tool_error" }),
      collapsedOptions,
      plainTheme,
      { isError: false },
    ).render(80).join("\n");

    expect(output).toContain("line 4");
    expect(output).not.toContain("Ctrl+O to expand");
    expect(output).not.toContain("…");
  });

  it("renders results without a theme", () => {
    const output = renderMcpToolResult(
      result([{ type: "text", text: "hello world" }]),
      collapsedOptions,
    ).render(80).join("\n");

    expect(output).toContain("hello world");
  });

  it("renders partial results without a theme", () => {
    const output = renderMcpToolResult(
      result([]),
      { expanded: false, isPartial: true },
    ).render(80).join("\n");

    expect(output).toContain("Running MCP tool...");
  });
});

describe("MCP tool call renderers without a theme", () => {
  it("renders proxy calls without a theme", () => {
    const output = renderMcpProxyToolCall({ tool: "test_tool", server: "demo" }).render(80).join("\n");
    expect(output).toContain("mcp call test_tool @ demo");
  });

  it("renders direct calls without a theme", () => {
    const output = createMcpDirectToolCallRenderer("test_tool")({ key: "value" }).render(80).join("\n");
    expect(output).toContain("test_tool");
  });
});

describe("formatMcpResultTitle", () => {
  it("always titles mcpScript regardless of details", () => {
    expect(formatMcpResultTitle("mcpScript", { mode: "script" })).toBe("mcpScript");
    expect(formatMcpResultTitle("mcpScript", undefined)).toBe("mcpScript");
  });

  it("reuses the resolved server/tool identity for a call", () => {
    expect(formatMcpResultTitle("mcp", { mode: "call", server: "github", tool: "get_me" })).toBe("github \u2192 get_me");
  });

  it("falls back to the proxy mode for non-call actions", () => {
    expect(formatMcpResultTitle("mcp", { mode: "connect", server: "figma" })).toBe("mcp connect figma");
    expect(formatMcpResultTitle("mcp", { mode: "describe", tool: { name: "get_nodes" } })).toBe("mcp describe get_nodes");
    expect(formatMcpResultTitle("mcp", { mode: "search", query: "figma" })).toBe('mcp search "figma"');
    expect(formatMcpResultTitle("mcp", { mode: "list", server: "figma" })).toBe("mcp list figma");
    expect(formatMcpResultTitle("mcp", { mode: "auth-start", server: "figma" })).toBe("mcp auth figma");
    expect(formatMcpResultTitle("mcp", { mode: "status" })).toBe("mcp status");
    expect(formatMcpResultTitle("mcp", undefined)).toBe("mcp");
  });

  it("names the requested (not-found) tool when describe fails", () => {
    expect(formatMcpResultTitle("mcp", { mode: "describe", error: "tool_not_found", requestedTool: "bogus_tool" })).toBe(
      "mcp describe bogus_tool",
    );
  });
});

describe("buildPendantToolResultDetails", () => {
  it("returns undefined when there's no text content", () => {
    expect(buildPendantToolResultDetails("mcp", result([]), false)).toBeUndefined();
    expect(buildPendantToolResultDetails("mcp", result([{ type: "text", text: "" }]), false)).toBeUndefined();
  });

  it("fences JSON text and titles a resolved call", () => {
    const details = buildPendantToolResultDetails(
      "mcp",
      result([{ type: "text", text: '{"login":"andyleap"}' }], { mode: "call", server: "github", tool: "get_me" }),
      false,
    );
    expect(details?.pendant.title).toBe("github \u2192 get_me");
    expect(details?.pendant.markdown).toBe('```json\n{"login":"andyleap"}\n```');
    expect(details?.pendant.expanded).toBe(false);
  });

  it("fences plain text and expands on error", () => {
    const details = buildPendantToolResultDetails("mcp", result([{ type: "text", text: "boom" }], { mode: "status" }), true);
    expect(details?.pendant.title).toBe("mcp status");
    expect(details?.pendant.markdown).toBe("\u26a0\ufe0f error\n\n```\nboom\n```");
    expect(details?.pendant.expanded).toBe(true);
  });

  it("joins multiple text blocks and ignores non-text blocks", () => {
    const details = buildPendantToolResultDetails(
      "mcpScript",
      result([{ type: "text", text: "a" }, { type: "image", data: "x", mimeType: "image/png" } as never, { type: "text", text: "b" }]),
      false,
    );
    expect(details?.pendant.title).toBe("mcpScript");
    expect(details?.pendant.markdown).toBe("```\na\n\nb\n```");
  });
});
