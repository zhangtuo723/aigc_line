import { useEffect, useMemo, useState } from 'react';
import type { AppSettingsView, ComfyWorkflowInfo } from '../shared/ipc.types';
import { useAppStore } from '../stores/app.store';

const fieldClass = 'w-full rounded-lg border border-white/[0.1] bg-[#09090e] px-3.5 py-3 text-sm text-[#e8e6df] outline-none transition placeholder:text-[#4f4c59] focus:border-[#d4af37]/60 focus:ring-2 focus:ring-[#d4af37]/10';

export function SettingsPage() {
  const setCurrentPage = useAppStore((state) => state.setCurrentPage);
  const [workflows, setWorkflows] = useState<ComfyWorkflowInfo[]>([]);
  const [savedSettings, setSavedSettings] = useState<AppSettingsView | null>(null);
  const [comfyuiBaseUrl, setComfyuiBaseUrl] = useState('http://127.0.0.1:8188');
  const [agentBaseUrl, setAgentBaseUrl] = useState('');
  const [agentToken, setAgentToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [clearAgentToken, setClearAgentToken] = useState(false);
  const [defaultImageWorkflowId, setDefaultImageWorkflowId] = useState('flux2-klein-9b-t2i');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    Promise.all([window.electronAPI.getAppSettings(), window.electronAPI.listComfyWorkflows()])
      .then(([settings, availableWorkflows]) => {
        setSavedSettings(settings);
        setComfyuiBaseUrl(settings.comfyuiBaseUrl);
        setAgentBaseUrl(settings.agentBaseUrl);
        setDefaultImageWorkflowId(settings.defaultImageWorkflowId);
        setWorkflows(availableWorkflows);
      })
      .finally(() => setLoading(false));
  }, []);

  const textToImageWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.kind === 'text-to-image'),
    [workflows],
  );

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await window.electronAPI.testComfyUIConnection(comfyuiBaseUrl));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice('');
    try {
      const next = await window.electronAPI.saveAppSettings({
        comfyuiBaseUrl,
        agentBaseUrl,
        defaultImageWorkflowId,
        agentToken: agentToken.trim() || undefined,
        clearAgentToken,
      });
      setSavedSettings(next);
      setAgentToken('');
      setClearAgentToken(false);
      setNotice('配置已保存，将在下一次生成或 Agent 对话时生效');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#0a0a0f]">
      <header className="relative flex items-center justify-between border-b border-white/[0.08] bg-[#0d0d14] px-8 py-4">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent" />
        <div className="flex items-center gap-4">
          <button onClick={() => setCurrentPage('home')} className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] text-[#8a8794] transition hover:border-[#d4af37]/40 hover:text-[#e8c766]" title="返回首页">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="font-display text-lg font-semibold tracking-[0.22em] text-[#e8c766]">系统配置</h1>
            <p className="mt-1 text-[11px] tracking-[0.22em] text-[#777482]">生成服务与 Agent 环境</p>
          </div>
        </div>
        <button onClick={handleSave} disabled={saving || loading} className="rounded-lg border border-[#d4af37]/50 bg-gradient-to-b from-[#e8c766] to-[#b08d2a] px-6 py-2.5 text-[13px] font-semibold tracking-widest text-[#241a05] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? '保存中…' : '保存配置'}
        </button>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-5 px-8 py-9">
          {notice && <div className="rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.07] px-4 py-3 text-sm text-[#d9c178]">{notice}</div>}

          <SettingsCard title="ComfyUI 服务" description="图片生成请求将发送到此服务器。修改后可先测试连接。">
            <label className="text-xs tracking-wider text-[#9a97a3]">HTTP 地址</label>
            <div className="mt-2 flex gap-3">
              <input value={comfyuiBaseUrl} onChange={(event) => { setComfyuiBaseUrl(event.target.value); setTestResult(null); }} className={fieldClass} placeholder="http://127.0.0.1:8188" spellCheck={false} />
              <button onClick={handleTest} disabled={testing || !comfyuiBaseUrl.trim()} className="shrink-0 rounded-lg border border-white/[0.12] bg-white/[0.05] px-5 text-sm text-[#d7d4cb] transition hover:border-[#d4af37]/40 hover:text-[#e8c766] disabled:opacity-40">
                {testing ? '测试中…' : '测试连接'}
              </button>
            </div>
            {testResult && <p className={`mt-2.5 text-xs ${testResult.success ? 'text-emerald-400' : 'text-rose-400'}`}>{testResult.message}</p>}
          </SettingsCard>

          <SettingsCard title="Agent 环境" description="用于 Agent SDK 的兼容 API 地址与认证 Token；留空 URL 时沿用进程环境变量。">
            <div className="grid gap-5">
              <div>
                <label className="text-xs tracking-wider text-[#9a97a3]">ANTHROPIC_BASE_URL</label>
                <input value={agentBaseUrl} onChange={(event) => setAgentBaseUrl(event.target.value)} className={`${fieldClass} mt-2`} placeholder="https://api.example.com" spellCheck={false} />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs tracking-wider text-[#9a97a3]">ANTHROPIC_AUTH_TOKEN</label>
                  {savedSettings?.agentTokenConfigured && !clearAgentToken && <span className="text-[11px] text-emerald-400">已安全配置</span>}
                </div>
                <div className="relative mt-2">
                  <input type={showToken ? 'text' : 'password'} value={agentToken} onChange={(event) => { setAgentToken(event.target.value); setClearAgentToken(false); }} className={`${fieldClass} pr-16`} placeholder={savedSettings?.agentTokenConfigured ? '留空以保留现有 Token' : '输入 Token'} autoComplete="off" spellCheck={false} />
                  <button type="button" onClick={() => setShowToken((value) => !value)} className="absolute inset-y-0 right-0 px-4 text-xs text-[#777482] hover:text-[#e8c766]">{showToken ? '隐藏' : '显示'}</button>
                </div>
                {savedSettings?.agentTokenConfigured && (
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-[#777482]">
                    <input type="checkbox" checked={clearAgentToken} onChange={(event) => { setClearAgentToken(event.target.checked); if (event.target.checked) setAgentToken(''); }} className="accent-[#d4af37]" />
                    清除已保存的 Token
                  </label>
                )}
                <p className="mt-2 text-[11px] leading-5 text-[#5f5c68]">Token 使用操作系统安全存储加密，保存后不会在页面中回显。</p>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard title="默认生图模型" description="新建图片节点及未单独指定模型的生成任务默认使用此工作流。">
            <div className="grid gap-3 sm:grid-cols-2">
              {textToImageWorkflows.map((workflow) => {
                const selected = workflow.id === defaultImageWorkflowId;
                return (
                  <button key={workflow.id} onClick={() => setDefaultImageWorkflowId(workflow.id)} className={`rounded-xl border p-4 text-left transition ${selected ? 'border-[#d4af37]/65 bg-[#d4af37]/[0.09] shadow-[0_0_20px_rgba(212,175,55,0.08)]' : 'border-white/[0.09] bg-white/[0.025] hover:border-white/[0.18]'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className={`text-sm font-medium ${selected ? 'text-[#e8c766]' : 'text-[#d8d6cf]'}`}>{workflow.name}</span>
                      <span className={`h-3.5 w-3.5 rounded-full border ${selected ? 'border-[#e8c766] bg-[#e8c766] shadow-[inset_0_0_0_3px_#18140b]' : 'border-[#5f5c68]'}`} />
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-[#666371]">{workflow.id}</p>
                  </button>
                );
              })}
            </div>
          </SettingsCard>
        </div>
      </main>
    </div>
  );
}

function SettingsCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#111118] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
      <div className="mb-5 border-b border-white/[0.07] pb-4">
        <h2 className="text-sm font-semibold tracking-[0.14em] text-[#e8e6df]">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-[#777482]">{description}</p>
      </div>
      {children}
    </section>
  );
}
