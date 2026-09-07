import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ options:[] as any[], starts:[] as any[], resumes:[] as any[], runs:[] as any[], events:[] as any[], hold:false, sessionIds:new Map<string,string>(), append:vi.fn(), update:vi.fn(), push:vi.fn(), end:vi.fn(), error:vi.fn(), close:vi.fn() }));
vi.mock('electron',()=>({app:{on:vi.fn(),getPath:()=>'/tmp'}}));
vi.mock('../electron/main/services/project.store',()=>({
 appendChatMessage:state.append,updateChatMessage:state.update,
 readSessionId:async(folder:string,provider:string)=>state.sessionIds.get(`${folder}:${provider}`)??null,
 writeSessionId:async(folder:string,id:string,provider:string)=>{state.sessionIds.set(`${folder}:${provider}`,id)},
}));
vi.mock('../electron/main/services/message-hub',()=>({messageHub:{pushToFrontend:state.push,notifyTurnEnd:state.end,notifyError:state.error}}));
vi.mock('../electron/main/services/agent/skills',()=>({scanAvailableSkills:async()=>[{name:'aigc-canvas:demo',path:'/builtin/demo/SKILL.md',description:'demo',source:'builtin'}]}));
vi.mock('../electron/main/services/agent/codex-runtime',()=>({getNetworkCodexRuntime:async()=>({executablePath:'/codex',env:{PATH:'/bin'}})}));
vi.mock('../electron/main/services/agent/canvas-mcp',()=>({startCanvasMcpBridge:async()=>({url:'http://127.0.0.1:1234/mcp',token:'test-token',close:state.close})}));
vi.mock('@openai/codex-sdk',()=>({Codex:class {
 constructor(options:any){state.options.push(options)}
 startThread(options:any){state.starts.push(options);return this.thread()}
 resumeThread(id:string,options:any){state.resumes.push({id,options});return this.thread()}
 thread(){return {runStreamed:async(input:any,options:any)=>{
 state.runs.push({input,options});
 return {events:(async function*(){
 for(const event of state.events) yield event;
 if(state.hold) await new Promise((_,reject)=>{if(options.signal.aborted)reject(new Error('aborted'));else options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
 })()};
 }}}
}}));
import {codexSession,getCodexQueue,sendCodexQueuedNow} from '../electron/main/services/agent/codex-session';
let sequence=0;
function setup(){const id=`sdk-project-${++sequence}`;return{id,session:codexSession({projectId:id,folderPath:`/workspace/${id}`,agent:{provider:'codex',model:'selected-model'}})}}
const message={id:'user-1',role:'user' as const,content:'/aigc-canvas:demo hello',timestamp:1,attachments:[{name:'image',type:'png',path:'/workspace/image.png'}]};
beforeEach(()=>{vi.clearAllMocks();state.options=[];state.starts=[];state.resumes=[];state.runs=[];state.events=[{type:'thread.started',thread_id:'sdk-thread'},{type:'turn.completed'}];state.hold=false});
describe('Codex SDK sessions',()=>{
 it('interrupts then resumes with the selected queued message first, preserving other messages',async()=>{
 const {session,id}=setup();state.hold=true;
 await session.enqueue(message);await vi.waitFor(()=>expect(state.runs).toHaveLength(1));
 await session.enqueue({...message,id:'queued-a',content:'second'});
 await session.enqueue({...message,id:'queued-b',content:'priority'});
 expect(getCodexQueue(id).map(m=>m.id)).toEqual(['queued-a','queued-b']);
 expect(state.push.mock.calls.some(call=>call[1].id==='queued-b' && call[1].deliveryStatus==='sent')).toBe(false);
 state.hold=false;state.events=[{type:'turn.completed'}];
 sendCodexQueuedNow(id,'queued-b');
 await vi.waitFor(()=>expect(state.end).toHaveBeenCalledTimes(1));
 expect(state.runs[0].options.signal.aborted).toBe(true);
 expect(state.runs).toHaveLength(3);
 expect(state.runs[1].input[0].text).toContain('priority');
 expect(state.runs[1].input[0].text).toContain('避免重复操作');
 expect(state.runs[2].input[0].text).toContain('second');
 expect(state.resumes[0].id).toBe('sdk-thread');
 expect(getCodexQueue(id)).toEqual([]);
 expect(state.push.mock.calls.some(call=>call[1].id==='queued-b' && call[1].deliveryStatus==='sent')).toBe(true);
 expect(state.error).not.toHaveBeenCalled();
 expect(()=>sendCodexQueuedNow(id,'queued-b')).toThrow('已开始处理');
 });
 it('keeps streaming after missing tool arguments or a newer runtime item type',async()=>{
 const {session}=setup();state.events=[
 {type:'item.started',item:{id:'partial',type:'mcp_tool_call',tool:'GetCanvasOverview',status:'in_progress'}},
 {type:'item.completed',item:{id:'partial',type:'mcp_tool_call',tool:'GetCanvasOverview',status:'completed',arguments:{}}},
 {type:'item.started',item:{id:'search',type:'web_search'}},
 {type:'item.completed',item:{id:'search',type:'web_search',query:'test'}},
 {type:'item.completed',item:{id:'new-kind',type:'future_tool',payload:{value:1}}},
 {type:'item.completed',item:{id:'reply',type:'agent_message',text:'继续完成'}},{type:'turn.completed'}];
 await session.enqueue(message);await vi.waitFor(()=>expect(state.end).toHaveBeenCalled());
 expect(state.error).not.toHaveBeenCalled();
 expect(state.push.mock.calls.some(call=>call[1].toolCall?.toolInput==='null')).toBe(true);
 expect(state.push.mock.calls.some(call=>call[1].toolCall?.toolInput.includes('future_tool'))).toBe(true);
 expect(state.append).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({content:'继续完成'}));
 });
 it('uses SDK model/cwd/resume options and a project-authenticated MCP bridge',async()=>{
 const {session,id}=setup();await session.enqueue(message);await vi.waitFor(()=>expect(state.end).toHaveBeenCalled());
 expect(state.options[0].config.mcp_servers.aigc_canvas).toMatchObject({url:'http://127.0.0.1:1234/mcp',bearer_token_env_var:'AIGC_CANVAS_MCP_TOKEN',required:true});
 expect(state.options[0].env.AIGC_CANVAS_MCP_TOKEN).toBe('test-token');
 expect(state.starts[0]).toMatchObject({model:'selected-model',workingDirectory:`/workspace/${id}`,skipGitRepoCheck:true});
 expect(state.runs[0].input).toContainEqual({type:'local_image',path:'/workspace/image.png'});
 expect(state.runs[0].input[0].text).toContain('/builtin/demo/SKILL.md');
 expect(state.sessionIds.get(`/workspace/${id}:codex`)).toBe('sdk-thread');
 await session.enqueue({...message,id:'user-2'});await vi.waitFor(()=>expect(state.end).toHaveBeenCalledTimes(2));
 expect(state.resumes[0].id).toBe('sdk-thread');expect(state.close).toHaveBeenCalledTimes(2);
 });
 it('maps streamed tool/text events and avoids item ID collisions between turns',async()=>{
 const {session}=setup();state.events=[{type:'thread.started',thread_id:'sdk-thread'},
 {type:'item.started',item:{id:'item_0',type:'mcp_tool_call',tool:'GetCanvasNode',arguments:{nodeId:'n'},status:'in_progress'}},
 {type:'item.completed',item:{id:'item_0',type:'mcp_tool_call',tool:'GetCanvasNode',arguments:{nodeId:'n'},status:'completed',result:{content:[]}}},
 {type:'item.updated',item:{id:'item_1',type:'agent_message',text:'Hello'}},
 {type:'item.completed',item:{id:'item_1',type:'agent_message',text:'Hello world'}},{type:'turn.completed'}];
 await session.enqueue(message);await vi.waitFor(()=>expect(state.end).toHaveBeenCalledTimes(1));
 await session.enqueue({...message,id:'user-2'});await vi.waitFor(()=>expect(state.end).toHaveBeenCalledTimes(2));
 const responses=state.append.mock.calls.map(call=>call[1]).filter(m=>m.role==='assistant');
 expect(responses).toHaveLength(2);expect(responses[0].id).not.toBe(responses[1].id);expect(responses[0].content).toBe('Hello world');
 expect(state.update).toHaveBeenCalledWith(expect.any(String),expect.any(String),expect.any(Function));
 });
 it('aborts through the SDK signal, drops queued turns and clears only Codex context',async()=>{
 const {session,id}=setup();state.hold=true;state.events=[{type:'thread.started',thread_id:'sdk-thread'},{type:'item.started',item:{id:'item_0',type:'command_execution',command:'wait',status:'in_progress'}}];
 await session.enqueue(message);await vi.waitFor(()=>expect(state.runs).toHaveLength(1));await expect(session.clear()).rejects.toThrow('正在处理');
 await session.enqueue({...message,id:'queued'});await session.interrupt();await vi.waitFor(()=>expect(state.end).toHaveBeenCalled());
 expect(state.runs[0].options.signal.aborted).toBe(true);expect(state.runs).toHaveLength(1);expect(state.error).not.toHaveBeenCalled();
 expect(state.push.mock.calls.some(call=>call[1].toolCall?.status==='interrupted')).toBe(true);
 await session.clear();expect(state.sessionIds.get(`/workspace/${id}:codex`)).toBe('');expect(state.append).toHaveBeenLastCalledWith(`/workspace/${id}`,expect.objectContaining({event:'context-cleared'}));
 });
 it('allows SDK reconnection events to recover before the final reply',async()=>{
 const {session}=setup();state.events=[{type:'error',message:'Reconnecting... 1/5 (request timed out)'},{type:'item.completed',item:{id:'item_0',type:'agent_message',text:'recovered'}},{type:'turn.completed'}];
 await session.enqueue(message);await vi.waitFor(()=>expect(state.end).toHaveBeenCalled());
 expect(state.error).not.toHaveBeenCalled();expect(state.append).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({content:'recovered'}));
 });
 it('reports failed turns and releases the MCP endpoint',async()=>{
 const {session,id}=setup();state.events=[{type:'turn.failed',error:{message:'model unavailable'}}];await session.enqueue(message);await vi.waitFor(()=>expect(state.end).toHaveBeenCalled());
 expect(state.error).toHaveBeenCalledWith(id,expect.stringContaining('model unavailable'));expect(state.close).toHaveBeenCalled();
 });
});
