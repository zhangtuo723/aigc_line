import { useState } from 'react';
import type { Cue, Scene } from '../shared/ipc.types';
import { useAppStore } from '../stores/app.store';

interface CueTableProps {
  cues: Cue[];
  scenes: Scene[];
}

export function CueTable({ cues, scenes }: CueTableProps) {
  const { currentProject, updateScenePrompt } = useAppStore();
  const [editingCueId, setEditingCueId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const getScene = (cueId: number) => scenes.find((s) => s.cueId === cueId);

  const startEdit = (cueId: number, prompt: string) => {
    setEditingCueId(cueId);
    setEditValue(prompt);
  };

  const saveEdit = async (cueId: number) => {
    await updateScenePrompt(cueId, editValue);
    setEditingCueId(null);
  };

  const cancelEdit = () => {
    setEditingCueId(null);
    setEditValue('');
  };

  if (cues.length === 0) {
    return (
      <div className='rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500'>
        暂无字幕 cue，请在工作区放入 .srt 文件
      </div>
    );
  }

  return (
    <div className='overflow-hidden rounded-xl border border-slate-200 bg-white'>
      <table className='w-full text-left text-sm'>
        <thead className='bg-slate-50'>
          <tr>
            <th className='px-4 py-2 font-medium text-slate-500'>#cue</th>
            <th className='px-4 py-2 font-medium text-slate-500'>时间</th>
            <th className='px-4 py-2 font-medium text-slate-500'>字幕</th>
            <th className='px-4 py-2 font-medium text-slate-500'>提示词</th>
            <th className='px-4 py-2 font-medium text-slate-500'>图片</th>
          </tr>
        </thead>
        <tbody className='divide-y divide-slate-100'>
          {cues.map((cue) => {
            const scene = getScene(cue.id);
            const isEditing = editingCueId === cue.id;
            return (
              <tr key={cue.id} className='hover:bg-slate-50'>
                <td className='px-4 py-2 text-slate-500'>{cue.id}</td>
                <td className='px-4 py-2 whitespace-nowrap text-slate-500'>
                  {formatTime(cue.start)} - {formatTime(cue.end)}
                </td>
                <td className='max-w-xs px-4 py-2 text-slate-700'>{cue.text}</td>
                <td className='px-4 py-2'>
                  {isEditing ? (
                    <div className='flex gap-2'>
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className='w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-cyan-500 focus:outline-none'
                        rows={2}
                      />
                      <div className='flex flex-col gap-1'>
                        <button
                          onClick={() => saveEdit(cue.id)}
                          className='rounded bg-cyan-600 px-2 py-0.5 text-xs text-white hover:bg-cyan-700'
                        >
                          保存
                        </button>
                        <button
                          onClick={cancelEdit}
                          className='rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-300'
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => startEdit(cue.id, scene?.prompt ?? '')}
                      className='cursor-pointer text-slate-600 hover:text-cyan-700'
                      title='点击编辑'
                    >
                      {scene?.prompt || (
                        <span className='italic text-slate-400'>未生成</span>
                      )}
                    </div>
                  )}
                </td>
                <td className='px-4 py-2'>
                  {scene?.imagePath ? (
                    <button
                      onClick={() => window.electronAPI.showItemInFolder(scene.imagePath!)}
                      className='text-xs text-cyan-600 hover:underline'
                    >
                      查看
                    </button>
                  ) : (
                    <span className='text-xs text-slate-400'>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
