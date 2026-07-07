import { startMcpServer } from "../../mcp/server.js";

/**
 * `pr-preview mcp` — run the Model Context Protocol server on stdio so an agent
 * (Claude Code) can drive a recording. The MCP transport owns stdout for
 * JSON-RPC, so every human-facing log the engine emits (console.log) must be
 * redirected to stderr or it would corrupt the protocol stream.
 */
export async function mcpCommand(repoRoot: string): Promise<void> {
  const toStderr = (...args: unknown[]) => {
    process.stderr.write(
      args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n",
    );
  };
  console.log = toStderr as typeof console.log;
  console.info = toStderr as typeof console.info;
  console.warn = toStderr as typeof console.warn;
  console.debug = toStderr as typeof console.debug;

  await startMcpServer(repoRoot);
}
