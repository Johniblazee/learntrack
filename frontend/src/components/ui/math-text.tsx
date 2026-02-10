/**
 * MathText - Renders text with LaTeX/math support using KaTeX
 * 
 * Supports:
 * - Inline math: $...$
 * - Display math: $$...$$
 * - Standard markdown formatting
 */
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { cn } from '@/lib/utils'

interface MathTextProps {
  children: string
  className?: string
  /** Render as block element (default: false for inline) */
  block?: boolean
}

/**
 * Renders text with markdown and LaTeX math support.
 * 
 * @example
 * <MathText>A block of mass $m$ with velocity $v$</MathText>
 * <MathText>$$F = ma$$</MathText>
 */
export function MathText({ children, className, block = false }: MathTextProps) {
  if (!children) return null

  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      className={cn(
        'math-text',
        // Base prose styling
        'prose prose-sm dark:prose-invert max-w-none',
        // Ensure KaTeX elements are visible
        '[&_.katex]:text-inherit [&_.katex-display]:my-2',
        // Handle inline vs block
        !block && '[&>p]:inline [&>p]:m-0',
        className
      )}
      components={{
        // For inline use, don't wrap in paragraph
        p: ({ children: pChildren }) =>
          block ? (
            <p className="m-0">{pChildren}</p>
          ) : (
            <span>{pChildren}</span>
          ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

export default MathText

