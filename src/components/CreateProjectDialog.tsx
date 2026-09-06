import { useEffect, useRef, useState } from 'react';
import type { AgentProvider, AgentModelOption } from '../shared/agent-config';
import { useAppStore } from '../stores/app.store';

export function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const createProject = useAppStore(state => state.createProject);
  const [provider, setProvider] = useState<AgentProvider>('claude-code');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<AgentModelOption[]>([]);
  const [modelError, setModelError] = useState('');
  const [loadingModels, setLoadingModels] = useState(true);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    setModels([]); setModelError(''); setLoadingModels(true);
    void window.electronAPI.listAgentModels(provider).then(result => {
      if (!active) return;
      setModels(result.models); setModelError(result.error ?? '');
    }).catch(error => { if (active) setModelError(String(error)); })
      .finally(() => { if (active) setLoadingModels(false); });
    return () => { active = false; };
  }, [provider, reload]);

  async function chooseFolder() {
    try {
      const folders = await window.electronAPI.showOpenDialog({ title: '选择项目目录' });
      if (folders[0]) {
        setFolder(folders[0]);
        setName(previous => previous || folders[0].split(/[/\\]/).filter(Boolean).pop() || '新项目');
      }
    } catch (error) { setError(String(error)); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !folder) return;
    setBusy(true); setError('');
    try { await createProject(name, folder, { provider, model: model.trim() }); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); setBusy(false); }
  }

  const field = 'mt-2 w-full rounded-lg border border-white/10 bg-[#09090f] px-3 py-3 text-sm text-[#e8e6df] outline-none focus:border-[#d4af37]/60';
  return <dialog ref={dialog} aria-labelledby="create-project-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} className="fixed inset-0 m-auto max-h-[90vh] w-[540px] max-w-[calc(100vw-32px)] overflow-auto rounded-2xl border border-white/10 bg-[#111119] p-7 text-[#e8e6df] shadow-2xl backdrop:bg-black/70">
    <form onSubmit={submit}>
      <h2 id="create-project-title" className="text-lg font-semibold tracking-wider">新建项目</h2>
      <p className="mt-2 text-xs leading-5 text-[#8a8794]">选择创作助手和工作目录，开始新的创作。</p>
      <fieldset disabled={busy} className="mt-6 min-w-0 space-y-5 disabled:opacity-60">
        <div><label className="text-xs text-[#aaa7b4]" htmlFor="project-name">项目名称</label><input autoFocus id="project-name" value={name} onChange={e => setName(e.target.value)} className={field} placeholder="为这次创作起个名字" maxLength={120} /></div>
        <div><label className="text-xs text-[#aaa7b4]" htmlFor="agent-provider">Agent 类型</label><select id="agent-provider" value={provider} onChange={e => { setProvider(e.target.value as AgentProvider); setModel(''); }} className={field}><option value="claude-code">Claude Code</option><option value="codex">Codex</option></select></div>
        <div>
          <label className="text-xs text-[#aaa7b4]" htmlFor="agent-model">模型</label>
          <select id="agent-model" disabled={loadingModels} aria-busy={loadingModels} value={models.some(m => m.id === model) || !model ? model : '__custom'} onChange={e => setModel(e.target.value === '__custom' ? ' ' : e.target.value)} className={`${field} disabled:cursor-wait disabled:opacity-60`}>
            <option value="">{loadingModels ? '正在加载模型…' : `沿用 ${provider === 'codex' ? 'Codex' : 'Claude Code'} 默认模型`}</option>
            {models.map(m => <option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}
            <option value="__custom">自定义模型…</option>
          </select>
          {!!model && !models.some(m => m.id === model) && <input aria-label="自定义模型 ID" value={model.trimStart()} onChange={e => setModel(e.target.value || ' ')} className={field} placeholder="输入当前服务支持的模型 ID" />}
          {loadingModels && <p className="mt-2 flex items-center gap-2 text-xs text-[#d4af37]" role="status"><span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#d4af37]/25 border-t-[#d4af37] motion-reduce:animate-none" />正在加载 {provider === 'codex' ? 'Codex' : 'Claude Code'} 模型，请稍候…</p>}
          {modelError && <div className="mt-2 text-xs leading-5 text-amber-300"><p>暂时无法读取模型列表，可使用默认模型或自定义模型。{modelError}</p><button type="button" onClick={() => setReload(r => r + 1)} className="mt-1 underline">重新读取</button></div>}
          <p className="mt-2 text-xs leading-5 text-[#8a8794]">使用本机 {provider === 'codex' ? 'Codex CLI' : 'Claude Code'} 的登录状态与配置。</p>
        </div>
        <div><span className="text-xs text-[#aaa7b4]">项目目录</span><button type="button" onClick={() => void chooseFolder()} className={`${field} flex items-center justify-between gap-3 text-left`}><span className="truncate" title={folder}>{folder || '选择项目目录'}</span><span className="shrink-0 text-[#e8c766]">浏览…</span></button><p className="mt-2 text-xs text-[#777482]">聊天记录、画布和生成素材保存在此目录。</p></div>
      </fieldset>
      {error && <p role="alert" className="mt-4 text-sm text-rose-400">{error}</p>}
      <div className="mt-7 flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-white/10 px-5 py-2.5 text-sm disabled:opacity-50">取消</button><button disabled={busy || !folder} className="rounded-lg bg-[#d4af37] px-5 py-2.5 text-sm font-semibold text-[#241a05] disabled:opacity-40">{busy ? '创建中…' : '创建项目'}</button></div>
    </form>
  </dialog>;
}
