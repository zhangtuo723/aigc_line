import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  children: string
  className?: string
}

export function Markdown({ children, className = '' }: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-bold text-[#f5f3ea] first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-bold text-[#f5f3ea] first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-2 text-sm font-semibold text-[#f5f3ea] first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-[#e8c766] underline hover:text-[#f0d98c]">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold text-[#f5f3ea]">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-[#d4af37]/40 pl-3 text-[#a09dae] last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-white/10" />,
          code: ({ children, className }) => {
            const isBlock = /language-/.test(className || '')
            return isBlock ? (
              <code className="block overflow-x-auto font-mono text-xs leading-relaxed">{children}</code>
            ) : (
              <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs text-[#f0d98c]">{children}</code>
            )
          },
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded-lg border border-white/10 bg-[#08080c] p-3 text-[#e8e6df] last:mb-0">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-white/15 bg-white/5 px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border border-white/15 px-2 py-1">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}