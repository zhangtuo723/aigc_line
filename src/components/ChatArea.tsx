import { useRef, useEffect } from 'react';
import type { ChatMessage } from '../shared/ipc.types';
import { useAppStore } from '../stores/app.store';
import { ChatMessageItem } from './ChatMessage';
import { ChatInput } from './ChatInput';

export function ChatArea() {
  const { messages, isAgentThinking, currentProject, sendChatMessage } = useAppStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (content: string, attachments?: ChatMessage['attachments']) => {
    if (!currentProject) return;
    sendChatMessage(content, attachments);
  };

  return (
    <div className='flex h-full flex-col bg-slate-50'>
      {/* Messages area */}
      <div className='flex-1 overflow-y-auto px-4 py-4'>
        {messages.length === 0 ? (
          <div className='flex h-full flex-col items-center justify-center text-slate-400'>
            <div className='mb-4 text-6xl'>🎬</div>
            <p className='text-lg font-medium text-slate-600'>AIGC Line Agent</p>
            <p className='mt-2 max-w-md text-center text-sm text-slate-500'>
              上传 SRT 字幕文件和 MP3 音频文件，我将为你自动生成手绘分镜视频。
            </p>
            <div className='mt-6 flex gap-2 text-xs text-slate-400'>
              <span className='rounded-full bg-slate-100 px-3 py-1'>上传 SRT + MP3</span>
              <span className='rounded-full bg-slate-100 px-3 py-1'>自动解析</span>
              <span className='rounded-full bg-slate-100 px-3 py-1'>生成视频</span>
            </div>
          </div>
        ) : (
          <div className='space-y-2'>
            {messages.map((message) => (
              <ChatMessageItem key={message.id} message={message} />
            ))}
            {isAgentThinking && (
              <div className='flex gap-3 py-3'>
                <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-medium text-violet-700'>
                  AI
                </div>
                <div className='rounded-tl-sm rounded-r-2xl bg-white px-4 py-2.5 shadow-sm'>
                  <div className='flex items-center gap-1.5'>
                    <div className='h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]' />
                    <div className='h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]' />
                    <div className='h-2 w-2 animate-bounce rounded-full bg-slate-400' />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <ChatInput onSend={handleSend} disabled={!currentProject || isAgentThinking} />
    </div>
  );
}
