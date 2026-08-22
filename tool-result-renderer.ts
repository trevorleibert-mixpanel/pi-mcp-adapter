import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";

type McpToolResultDetails = Record<string, unknown> & { error?: unknown };
type McpToolContentBlock = AgentToolResult<McpToolResultDetails>["content"][number];

interface RenderTheme {
  fg: (name: string, text: string) => string;
  bold?: (text: string) => string;
}

const plainTheme: RenderTheme = { fg: (_name, text) => text };

export interface McpProxyToolCallInput {
  tool?: string;
  args?: string | Record<string, unknown>;
  connect?: string;
  describe?: string;
  search?: string;
  regex?: boolean;
  includeSchemas?: boolean;
  server?: string;
  action?: string;
}

interface McpToolRenderContext {
  isError: boolean;
}

export interface McpToolResultDisplay {
  lines: string[];
  truncated: boolean;
}

const DEFAULT_MAX_CALL_INPUT_CHARS = 1500;
const DEFAULT_MAX_COLLAPSED_LINES = 3;
const DEFAULT_MAX_COLLAPSED_CHARS = 8000;
const COLLAPSED_RENDER_CHAR_SLACK = 8;

class CollapsibleText implements Component {
  private readonly fullText: Text;
  private readonly footerText: Text;
  private collapsedText: { charBudget: number; fullyIncluded: boolean; text: Text } | null = null;
  private collapsedRender: { width: number; charBudget: number; lines: string[] } | null = null;

  constructor(
    private readonly text: string,
    private readonly expanded: boolean,
    private readonly maxCollapsedLines: number,
    private readonly ellipsis: string,
    private readonly expandHint: string,
    private readonly preTruncated = false,
  ) {
    this.fullText = new Text(text, 0, 0);
    this.footerText = new Text(`${ellipsis}\n${expandHint}`, 0, 0);
  }

  render(width: number): string[] {
    if (this.expanded) {
      return this.fullText.render(width);
    }

    const safeWidth = Math.max(1, Math.floor(width));
    const charBudget = safeWidth * (this.maxCollapsedLines + 1) * COLLAPSED_RENDER_CHAR_SLACK;
    if (!this.collapsedText || this.collapsedText.charBudget !== charBudget) {
      const prefix = this.text.length > charBudget
        ? this.text.slice(0, charBudget)
        : this.text;
      this.collapsedText = {
        charBudget,
        fullyIncluded: prefix === this.text,
        text: new Text(prefix, 0, 0),
      };
      this.collapsedRender = null;
    }

    const lines = this.collapsedText.text.render(width);
    if (!this.preTruncated && this.collapsedText.fullyIncluded && lines.length <= this.maxCollapsedLines) return lines;
    if (this.collapsedRender?.width === width && this.collapsedRender.charBudget === charBudget) {
      return this.collapsedRender.lines;
    }

    const rendered = [
      ...lines.slice(0, this.maxCollapsedLines),
      ...this.footerText.render(width),
    ];
    this.collapsedRender = { width, charBudget, lines: rendered };
    return rendered;
  }

  invalidate(): void {
    this.fullText.invalidate();
    this.footerText.invalidate();
    this.collapsedText?.text.invalidate();
    this.collapsedRender = null;
  }
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function formatJsonish(value: unknown, maxChars: number): string {
  if (typeof value === "string") {
    try {
      return truncateText(JSON.stringify(JSON.parse(value), null, 2), maxChars);
    } catch {
      return truncateText(value, maxChars);
    }
  }

  try {
    return truncateText(JSON.stringify(value, null, 2), maxChars);
  } catch {
    return truncateText(String(value), maxChars);
  }
}

function hasUsefulObjectContent(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

export function formatMcpProxyToolCallLines(
  args: McpProxyToolCallInput,
  maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS,
): string[] {
  if (args.action === "ui-messages") return [`mcp ${args.action}`];

  if (args.tool) {
    const target = args.server ? `${args.tool} @ ${args.server}` : args.tool;
    const lines = [`mcp call ${target}`];
    if (args.args) lines.push(formatJsonish(args.args, maxInputChars));
    return lines;
  }

  if (args.connect) return [`mcp connect ${args.connect}`];
  if (args.describe) return [`mcp describe ${args.describe}`];

  if (args.search) {
    let line = `mcp search ${args.search}`;
    if (args.server) line += ` @ ${args.server}`;
    if (args.regex === true) line += " (regex)";
    if (args.includeSchemas === false) line += " (schemas hidden)";
    return [line];
  }

  if (args.server) return [`mcp list ${args.server}`];
  if (args.action) return [`mcp ${args.action}`];

  return ["mcp status"];
}

export function formatMcpDirectToolCallLines(
  displayName: string,
  args: Record<string, unknown>,
  maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS,
): string[] {
  if (!hasUsefulObjectContent(args)) return [displayName];
  return [displayName, formatJsonish(args, maxInputChars)];
}

function renderToolCallLines(lines: string[], theme?: RenderTheme) {
  const activeTheme = theme ?? plainTheme;
  const [title = "mcp", ...rest] = lines;
  const styledTitle = activeTheme.fg("toolTitle", activeTheme.bold ? activeTheme.bold(title) : title);
  const styledRest = rest.map(line => activeTheme.fg("muted", line));
  return new Text([styledTitle, ...styledRest].join("\n"), 0, 0);
}

export function renderMcpProxyToolCall(args: McpProxyToolCallInput, theme?: RenderTheme) {
  return renderToolCallLines(formatMcpProxyToolCallLines(args), theme);
}

export function createMcpDirectToolCallRenderer(displayName: string) {
  return (args: Record<string, unknown>, theme?: RenderTheme) => {
    return renderToolCallLines(formatMcpDirectToolCallLines(displayName, args), theme);
  };
}

function blockToLines(block: McpToolContentBlock): string[] {
  if (block.type === "text") {
    return block.text.split("\n");
  }
  return [`[image: ${block.mimeType}]`];
}

function collectCollapsedResultLines(
  content: AgentToolResult<McpToolResultDetails>["content"],
  maxLines: number,
  maxChars: number,
): McpToolResultDisplay {
  if (content.length === 0) return { lines: ["(empty result)"], truncated: false };

  const lines: string[] = [];
  let remainingChars = maxChars;
  let truncated = false;

  const appendLine = (line: string) => {
    if (lines.length >= maxLines || remainingChars <= 0) {
      truncated = true;
      return false;
    }

    if (line.length > remainingChars) {
      lines.push(line.slice(0, remainingChars));
      truncated = true;
      remainingChars = 0;
      return false;
    }

    lines.push(line);
    remainingChars -= line.length + 1;
    return true;
  };

  for (const block of content) {
    if (block.type !== "text") {
      if (!appendLine(`[image: ${block.mimeType}]`)) break;
      continue;
    }

    let start = 0;
    while (start <= block.text.length) {
      const newline = block.text.indexOf("\n", start);
      const line = newline === -1 ? block.text.slice(start) : block.text.slice(start, newline);
      if (!appendLine(line)) break;
      if (newline === -1) break;
      start = newline + 1;
    }

    if (truncated) break;
  }

  if (lines.length === 0) lines.push("");
  if (truncated && lines.length >= maxLines) lines.push("…");
  return { lines, truncated };
}

export function formatMcpToolResultIdentity(details: McpToolResultDetails | undefined): string | null {
  if (details?.mode !== "call") return null;
  const server = typeof details.server === "string"
    ? details.server
    : typeof details.hintServer === "string"
      ? details.hintServer
      : null;
  if (!server) return null;
  if (typeof details.tool === "string") return `MCP ${server}/${details.tool}`;
  if (typeof details.resourceUri === "string") return `MCP ${server} resource ${details.resourceUri}`;
  if (typeof details.requestedTool === "string") return `MCP ${server}/${details.requestedTool}`;
  return null;
}

/**
 * Human-readable title for an mcp/mcpScript result, reusing the resolved
 * server/tool identity when available (see formatMcpToolResultIdentity) and
 * falling back to the proxy mode for status/search/connect/etc. Used by
 * Pendant (the VS Code extension), which shows this as the tool call's row
 * title instead of the tool's static registration label ("MCP").
 */
export function formatMcpResultTitle(toolName: string, details: McpToolResultDetails | undefined): string {
  if (toolName === "mcpScript") return "mcpScript";

  const identity = formatMcpToolResultIdentity(details);
  if (identity) return identity.replace(/^MCP /, "").replace("/", " \u2192 ");

  const mode = typeof details?.mode === "string" ? details.mode : undefined;
  const server = typeof details?.server === "string" ? details.server : undefined;
  switch (mode) {
    case "connect":
      return server ? `mcp connect ${server}` : "mcp connect";
    case "describe": {
      const tool = details?.tool;
      const resolvedName = tool && typeof tool === "object" && "name" in tool && typeof (tool as { name?: unknown }).name === "string"
        ? (tool as { name: string }).name
        : undefined;
      // Falls back to the requested (possibly not-found) tool name so a
      // "describe" of an unknown tool still names what was looked up.
      const name = resolvedName ?? (typeof details?.requestedTool === "string" ? details.requestedTool : undefined);
      return name ? `mcp describe ${name}` : "mcp describe";
    }
    case "search":
      return typeof details?.query === "string" ? `mcp search "${details.query}"` : "mcp search";
    case "list":
      return server ? `mcp list ${server}` : "mcp list";
    case "auth-start":
    case "auth-complete":
      return server ? `mcp auth ${server}` : "mcp auth";
    case "status":
      return "mcp status";
    default:
      return "mcp";
  }
}

function fenceForPendant(text: string): string {
  const trimmed = text.trim();
  try {
    JSON.parse(trimmed);
    return `\`\`\`json\n${trimmed}\n\`\`\``;
  } catch {
    return `\`\`\`\n${text}\n\`\`\``;
  }
}

export interface PendantToolResultDetails {
  pendant: { title: string; markdown: string; expanded?: boolean };
}

/**
 * Builds the `details.pendant` payload Pendant (the VS Code extension) reads
 * off a tool_result to render an mcp/mcpScript call's row title and body in
 * its webview, instead of a generic JSON dump under the tool's static label.
 * Returns undefined when there's no text content to show.
 *
 * `title`/`markdown`/`expanded` aren't publicly documented; confirmed by
 * live A/B testing against Pendant 0.30.1 (cdervis.vscode-pi). `label` was
 * also tried and does nothing. If Pendant changes this shape, this is the
 * only place that needs updating.
 */
export function buildPendantToolResultDetails(
  toolName: string,
  result: Pick<AgentToolResult<McpToolResultDetails>, "content" | "details">,
  isError: boolean,
): PendantToolResultDetails | undefined {
  const text = result.content
    .filter((block): block is Extract<McpToolContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
  if (!text) return undefined;

  const title = formatMcpResultTitle(toolName, result.details);
  const markdown = isError ? `\u26a0\ufe0f error\n\n${fenceForPendant(text)}` : fenceForPendant(text);
  return { pendant: { title, markdown, expanded: isError } };
}

export function formatMcpToolResultLines(
  result: Pick<AgentToolResult<McpToolResultDetails>, "content">,
  expanded: boolean,
  maxCollapsedLines = 3,
  maxCollapsedChars = DEFAULT_MAX_COLLAPSED_CHARS,
): McpToolResultDisplay {
  if (!expanded) {
    return collectCollapsedResultLines(result.content, maxCollapsedLines, maxCollapsedChars);
  }

  const allLines = result.content.flatMap(blockToLines);
  const lines = allLines.length > 0 ? allLines : ["(empty result)"];
  return { lines, truncated: false };
}

export function renderMcpToolResult(
  result: AgentToolResult<McpToolResultDetails>,
  options: ToolRenderResultOptions,
  theme?: RenderTheme,
  context?: McpToolRenderContext,
) {
  const activeTheme = theme ?? plainTheme;
  if (options.isPartial) {
    return new Text(activeTheme.fg("warning", "Running MCP tool..."), 0, 0);
  }

  const hasErrorDetails = Boolean(result.details.error);
  const expanded = options.expanded || context?.isError === true || hasErrorDetails;
  const display = formatMcpToolResultLines(result, expanded);
  const identity = formatMcpToolResultIdentity(result.details);
  const output = [
    ...(identity ? [activeTheme.fg("muted", identity)] : []),
    ...display.lines.map((line) => activeTheme.fg("toolOutput", line)),
  ].join("\n");

  return new CollapsibleText(
    output,
    expanded,
    DEFAULT_MAX_COLLAPSED_LINES + (identity ? 1 : 0),
    activeTheme.fg("muted", "…"),
    activeTheme.fg("muted", "(Ctrl+O to expand)"),
    display.truncated,
  );
}
