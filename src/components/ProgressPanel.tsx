import type { WorkflowProgress } from '../shared/ipc.types';

interface ProgressPanelProps {
  progress: WorkflowProgress | null;
}

const STEP_LABELS: Record<WorkflowProgress['step'], string> = {
  idle: '空闲',
  parsing: '解析工作区',
  prompting: '生成提示词',
  generating: '生成分镜图',
  assembling: '合成视频',
  done: '完成',
  error: '错误',
};

export function ProgressPanel({ progress }: ProgressPanelProps) {
  if (!progress) return null;

  const isError = progress.step === 'error';
  const isDone = progress.step === 'done';

  return (
    <div
      className={[
        'rounded-xl border p-4',
        isError
          ? 'border-red-200 bg-red-50'
          : isDone
            ? 'border-green-200 bg-green-50'
            : 'border-cyan-200 bg-cyan-50',
      ].join(' ')}
    >
      <div className='mb-2 flex items-center justify-between'>
        <span
          className={[
            'text-sm font-medium',
            isError ? 'text-red-700' : isDone ? 'text-green-700' : 'text-cyan-800',
          ].join(' ')}
        >
          {STEP_LABELS[progress.step]}
        </span>
        <span className='text-sm text-slate-500'>{progress.percent}%</span>
      </div>
      <div className='mb-2 h-2 w-full overflow-hidden rounded-full bg-white'>
        <div
          className={[
            'h-full transition-all duration-300',
            isError ? 'bg-red-500' : isDone ? 'bg-green-500' : 'bg-cyan-500',
          ].join(' ')}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <p
        className={[
          'text-sm',
          isError ? 'text-red-700' : 'text-slate-600',
        ].join(' ')}
      >
        {progress.message}
      </p>
    </div>
  );
}
