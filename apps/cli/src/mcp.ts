// jobsworld mcp —— 给 coding agent（Claude Code、Codex、opencode…）用的本机 MCP 服务（stdio）。
// 工具定义在 @pux/engine/launch/tools（远程的 /mcp 用同一份）；这里经 HTTP 调 Jobs 服务（JOBS_API、JOBS_KEY）。
// Jobs 在别的机器或云端时，不需要这个命令：直接把 <Jobs 地址>/mcp 加给 agent（见 docs/API.md「远程 MCP」）。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { jobsVersion } from '@pux/core';
import { JOBS_TOOLS, MCP_INSTRUCTIONS } from '@pux/engine/launch/tools';
import { api } from './client.ts';

export async function runMcp() {
  const server = new McpServer({ name: 'jobs', version: jobsVersion() }, { instructions: MCP_INSTRUCTIONS });
  for (const t of JOBS_TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.input }, async (args: Record<string, unknown>, extra) => {
      const token = extra._meta?.progressToken;
      const progress = token === undefined ? undefined : (done: number, total: number, message: string) => extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: done, total, message } });
      try { return { content: [{ type: 'text' as const, text: await t.run(args, { api, signal: extra.signal, progress }) }] }; }
      catch (e) { return { content: [{ type: 'text' as const, text: `出错：${String((e as Error).message ?? e)}` }], isError: true }; }
    });
  }
  await server.connect(new StdioServerTransport());
}
