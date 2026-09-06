import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createCanvasTools } from './tools';

export interface CanvasMcpBridge { url: string; token: string; close: () => Promise<void> }

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('MCP 请求超过 2 MB');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Per-project loopback MCP endpoint. Its random token only goes to that SDK child. */
export async function startCanvasMcpBridge(
  projectId: string,
  folderPath: string,
  canInvoke: () => boolean,
): Promise<CanvasMcpBridge> {
  const token = randomBytes(32).toString('hex');
  const authorization = Buffer.from(`Bearer ${token}`);
  const connections = new Set<McpServer>();
  const server = createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization)) {
      response.writeHead(401).end(); return;
    }
    const address = server.address();
    if (!address || typeof address === 'string' || request.headers.host !== `127.0.0.1:${address.port}` || request.headers.origin) {
      response.writeHead(403).end(); return;
    }
    if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
    const mcp = new McpServer({ name: 'aigc-canvas', version: '1.0.0' });
    connections.add(mcp);
    response.on('close', () => { connections.delete(mcp); void mcp.close().catch(() => undefined); });
    try {
      for (const tool of createCanvasTools(projectId, folderPath)) {
        mcp.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args: any) => {
          if (!canInvoke()) return { isError: true, content: [{ type: 'text' as const, text: '项目 Agent 已停止，不能继续操作画布。' }] };
          return tool.handler(args, {});
        });
      }
      const body = await readBody(request);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/json' });
      if (!response.writableEnded) response.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动画布 MCP 服务');
  return {
    url: `http://127.0.0.1:${address.port}/mcp`, token,
    close: async () => {
      await Promise.allSettled([...connections].map(connection => connection.close()));
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    },
  };
}
