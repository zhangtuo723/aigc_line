import type { WorkflowResult } from '../shared/ipc.types';

interface ResultPanelProps {
  result: WorkflowResult | null;
}

export function ResultPanel({ result }: ResultPanelProps) {
  if (!result) return null;

  if (result.status === 'success' && result.outputPath) {
    return (
      <div className='rounded-xl border border-green-200 bg-green-50 p-4'>
        <h3 className='mb-2 text-sm font-semibold text-green-800'>视频生成成功</h3>
        <p className='mb-3 break-all text-xs text-slate-600'>{result.outputPath}</p>
        <button
          onClick={() => window.electronAPI.showItemInFolder(result.outputPath!)}
          className='rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700'
        >
          打开所在文件夹
        </button>
      </div>
    );
  }

  if (result.status === 'cancelled') {
    return (
      <div className='rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800'>
        工作流已取消
      </div>
    );
  }

  return (
    <div className='rounded-xl border border-red-200 bg-red-50 p-4'>
      <h3 className='mb-1 text-sm font-semibold text-red-800'>工作流失败</h3>
      <p className='text-sm text-red-700'>{result.error || '未知错误'}</p>
    </div>
  );
}
