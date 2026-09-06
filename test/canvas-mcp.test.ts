import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const command = vi.hoisted(() => vi.fn(async (projectId:string,action:string,payload:unknown) => ({result:{projectId,action,payload}})));
vi.mock('electron',()=>({app:{getPath:()=>'/tmp'},BrowserWindow:{getAllWindows:()=>[]},safeStorage:{}}));
vi.mock('../electron/main/services/agent/canvas-bridge',()=>({sendCanvasCommand:command}));
import { startCanvasMcpBridge, type CanvasMcpBridge } from '../electron/main/services/agent/canvas-mcp';
const bridges:CanvasMcpBridge[]=[]; const clients:Client[]=[];
afterEach(async()=>{await Promise.allSettled(clients.splice(0).map(c=>c.close()));await Promise.all(bridges.splice(0).map(b=>b.close()));vi.clearAllMocks()});
async function setup(projectId:string,canInvoke=()=>true){const bridge=await startCanvasMcpBridge(projectId,'/workspace',canInvoke);bridges.push(bridge);const client=new Client({name:'test',version:'1.0'});clients.push(client);await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url),{requestInit:{headers:{Authorization:`Bearer ${bridge.token}`}}}));return{bridge,client}}
describe('Codex canvas MCP integration',()=>{
 it('discovers all shared tools and validates calls before modifying the correct project',async()=>{
 const {client}=await setup('project-one');const list=await client.listTools();expect(list.tools.map(t=>t.name)).toEqual(expect.arrayContaining(['GetCanvasNode','CreateCanvasNodes','InvokeNodeAction','AnalyzeVideo','PushArtifact']));
 const result=await client.callTool({name:'GetCanvasNode',arguments:{nodeId:'node-7'}});
 expect(result.isError).not.toBe(true);expect(command).toHaveBeenCalledWith('project-one','get-node',{nodeId:'node-7'});
 const invalid=await client.callTool({name:'GetCanvasNode',arguments:{}});expect(invalid.isError).toBe(true);expect(command).toHaveBeenCalledTimes(1);
 });
 it('rejects unauthenticated, cross-project and browser-origin requests and stops tool writes',async()=>{
 let active=true;const one=await setup('one',()=>active);const two=await setup('two');
 expect((await fetch(one.bridge.url)).status).toBe(401);
 expect((await fetch(one.bridge.url,{headers:{Authorization:`Bearer ${two.bridge.token}`}})).status).toBe(401);
 expect((await fetch(one.bridge.url,{headers:{Authorization:`Bearer ${one.bridge.token}`,Origin:'https://example.com'}})).status).toBe(403);
 active=false;const result=await one.client.callTool({name:'GetCanvasOverview',arguments:{}});expect(result.isError).toBe(true);expect(command).not.toHaveBeenCalled();
 });
});
