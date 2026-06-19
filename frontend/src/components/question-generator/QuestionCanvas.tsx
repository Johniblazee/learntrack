/**
 * QuestionCanvas - Single-question review canvas with navigation arrows and bottom question strip.
 * Shows one question at a time for focused review, with a filmstrip of all questions at the bottom.
 */
import { useRef, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AgentStatusBar } from './AgentStatusBar'
import { QuestionCard } from './QuestionCard'
import {
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  Download,
  CheckCircle,
  BookCheck,
  Check,
  X,
} from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-state'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { cn } from '@/lib/utils'
import { GeneratedQuestion } from './types'

interface QuestionCanvasProps {
  isGenerating: boolean
  currentAction: string | null
  thinkingSteps: string[]
  progress: { current: number; total: number }
  foundSources: Array<{ id: string; title: string; excerpt: string }>

  questions: GeneratedQuestion[]
  streamingContent?: string
  activeIndex: number
  onActiveIndexChange: (index: number) => void

  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onEdit?: (id: string, updates: Partial<GeneratedQuestion>) => void
  onRequestRegenerate?: (id: string, defaultMessage: string) => void
  onDelete?: (id: string) => void
  onCycleVersion?: (questionId: string, direction: 'prev' | 'next') => void
  onApproveAll?: () => void
  onPublishApproved?: () => void
  onExport?: () => void
}

/**
 * StreamingMarkdown - Renders markdown content as it streams in.
 * Hides the JSON block at the end for cleaner display during streaming.
 */
function StreamingMarkdown({ content }: { content: string }) {
  const displayContent = useMemo(() => {
    let processed = content
    processed = processed.replace(/```json[\s\S]*?```/g, '')
    const partialJsonMatch = processed.match(/```json[\s\S]*$/)
    if (partialJsonMatch) {
      processed = processed.substring(0, processed.indexOf('```json'))
    }
    processed = processed.replace(/```\s*$/, '')
    return processed.trim()
  }, [content])

  if (!displayContent) return null

  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        '[&>h2]:text-lg [&>h2]:font-semibold [&>h2]:text-primary [&>h2]:mt-4 [&>h2]:mb-2',
        '[&>h3]:text-base [&>h3]:font-medium [&>h3]:text-foreground [&>h3]:mt-3 [&>h3]:mb-1',
        '[&>p]:text-sm [&>p]:text-foreground/90 [&>p]:my-2',
        '[&>ul]:text-sm [&>ul]:my-2 [&>ul]:space-y-1',
        '[&>ul>li]:text-foreground/90',
        '[&>hr]:my-3 [&>hr]:border-border',
        '[&_strong]:text-foreground [&_strong]:font-semibold',
        '[&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded',
      )}
    >
      {displayContent}
    </ReactMarkdown>
  )
}

/**
 * QuestionThumbnail - A small preview card in the bottom strip
 */
function QuestionThumbnail({
  question,
  index,
  isActive,
  onClick,
}: {
  question: GeneratedQuestion
  index: number
  isActive: boolean
  onClick: () => void
}) {
  const previewText = question.question_text.length > 40
    ? question.question_text.slice(0, 40) + '...'
    : question.question_text

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex-shrink-0 w-[130px] rounded-lg border px-2.5 py-2 text-left transition-all cursor-pointer',
        'hover:border-primary/50 hover:bg-muted/50',
        isActive
          ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
          : 'border-border bg-card',
      )}
    >
      {/* Status indicator */}
      {question.status === 'approved' && (
        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
          <Check className="h-3 w-3 text-white" />
        </div>
      )}
      {question.status === 'rejected' && (
        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shadow-sm">
          <X className="h-3 w-3 text-white" />
        </div>
      )}

      <p className="text-[10px] font-bold text-primary mb-0.5">
        Q{index + 1}
      </p>
      <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2">
        {previewText}
      </p>
    </button>
  )
}

export function QuestionCanvas({
  isGenerating,
  currentAction,
  thinkingSteps,
  progress,
  foundSources,
  questions,
  streamingContent,
  activeIndex,
  onActiveIndexChange,
  onApprove,
  onReject,
  onEdit,
  onRequestRegenerate,
  onDelete,
  onCycleVersion,
  onApproveAll,
  onPublishApproved,
  onExport,
}: QuestionCanvasProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const activeQuestion = questions[activeIndex]

  const pendingCount = questions.filter(q => q.status === 'pending' || !q.status).length
  const approvedCount = questions.filter(q => q.status === 'approved').length
  const publishedCount = questions.filter(q => Boolean(q.published_question_id)).length
  const publishReadyCount = questions.filter(q => q.status === 'approved').length

  const goToPrev = useCallback(() => {
    if (activeIndex > 0) onActiveIndexChange(activeIndex - 1)
  }, [activeIndex, onActiveIndexChange])

  const goToNext = useCallback(() => {
    if (activeIndex < questions.length - 1) onActiveIndexChange(activeIndex + 1)
  }, [activeIndex, questions.length, onActiveIndexChange])

  // Auto-advance to newest question when generating
  useEffect(() => {
    if (isGenerating && questions.length > 0) {
      onActiveIndexChange(questions.length - 1)
    }
  }, [questions.length, isGenerating, onActiveIndexChange])

  // Scroll active thumbnail into view
  useEffect(() => {
    if (!stripRef.current) return
    const activeThumb = stripRef.current.children[activeIndex] as HTMLElement | undefined
    activeThumb?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeIndex])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      if (!activeQuestion || isGenerating) return

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          goToPrev()
          break
        case 'ArrowRight':
          e.preventDefault()
          goToNext()
          break
        case 'j':
        case 'J':
          e.preventDefault()
          if (activeQuestion.status !== 'rejected') {
            onReject?.(activeQuestion.question_id)
          }
          break
        case 'e':
        case 'E':
          // Edit is handled inside QuestionCard, but we can let it bubble
          break
        case 'r':
        case 'R':
          e.preventDefault()
          onRequestRegenerate?.(activeQuestion.question_id, 'Regenerate question with adjustments: ')
          break
        case 'k':
        case 'K':
        case ' ':
          e.preventDefault()
          if (activeQuestion.status !== 'approved') {
            onApprove?.(activeQuestion.question_id)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeQuestion, isGenerating, goToPrev, goToNext, onApprove, onReject, onRequestRegenerate])

  return (
    <div className="flex flex-col h-full">
      {/* Status Bar */}
      {isGenerating && (
        <div className="px-4 pt-3 pb-2 border-b">
          <AgentStatusBar
            isGenerating={isGenerating}
            currentAction={currentAction}
            thinkingSteps={thinkingSteps}
            progress={progress}
            foundSources={foundSources}
          />
        </div>
      )}

      {/* Main Canvas Area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative px-4 py-6">
        {questions.length === 0 && !isGenerating ? (
          <EmptyCanvasState />
        ) : isGenerating && !activeQuestion ? (
          /* Streaming preview when no question is complete yet */
          <GeneratingPreview
            progress={progress}
            streamingContent={streamingContent}
          />
        ) : activeQuestion ? (
          <>
            {/* Left Arrow */}
            <button
              type="button"
              onClick={goToPrev}
              disabled={activeIndex <= 0}
              className={cn(
                'flex-shrink-0 w-10 h-10 rounded-full border flex items-center justify-center transition-all mr-4',
                activeIndex <= 0
                  ? 'border-border text-muted-foreground/30 cursor-not-allowed'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted hover:border-primary/30 cursor-pointer',
              )}
              aria-label="Previous question"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            {/* Question Card */}
            <div className="flex-1 max-w-3xl overflow-y-auto max-h-full">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeQuestion.question_id}
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <QuestionCard
                    question={activeQuestion}
                    index={activeIndex}
                    isStreaming={false}
                    onEdit={onEdit}
                    onApprove={onApprove}
                    onReject={onReject}
                    onDelete={onDelete}
                    onCycleVersion={onCycleVersion}
                    onRequestRegenerate={onRequestRegenerate}
                  />
                </motion.div>
              </AnimatePresence>

              {/* Streaming preview for next question below current */}
              {isGenerating && streamingContent && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4"
                >
                  <GeneratingPreview
                    progress={progress}
                    streamingContent={streamingContent}
                  />
                </motion.div>
              )}
            </div>

            {/* Right Arrow */}
            <button
              type="button"
              onClick={goToNext}
              disabled={activeIndex >= questions.length - 1}
              className={cn(
                'flex-shrink-0 w-10 h-10 rounded-full border flex items-center justify-center transition-all ml-4',
                activeIndex >= questions.length - 1
                  ? 'border-border text-muted-foreground/30 cursor-not-allowed'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted hover:border-primary/30 cursor-pointer',
              )}
              aria-label="Next question"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : null}
      </div>

      {/* Bottom Question Strip */}
      {questions.length > 0 && (
        <div className="border-t bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Set label */}
            <div className="flex-shrink-0 text-xs text-muted-foreground font-medium">
              SET &middot; {questions.length}
            </div>

            {/* Thumbnail strip */}
            <div
              ref={stripRef}
              className="flex-1 flex items-center gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-border py-1"
            >
              {questions.map((question, idx) => (
                <QuestionThumbnail
                  key={question.question_id}
                  question={question}
                  index={idx}
                  isActive={idx === activeIndex}
                  onClick={() => onActiveIndexChange(idx)}
                />
              ))}
            </div>

            {/* Page indicator */}
            <div className="flex-shrink-0 text-xs text-muted-foreground font-medium tabular-nums">
              {activeIndex + 1} / {questions.length}
            </div>
          </div>

          {/* Footer Actions */}
          {!isGenerating && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{questions.length} questions</span>
                {pendingCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">{pendingCount} pending</span>
                )}
                {approvedCount > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">{approvedCount} approved</span>
                )}
                {publishedCount > 0 && (
                  <span className="text-blue-600 dark:text-blue-400">{publishedCount} published</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={onExport}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Export
                </Button>
                {publishReadyCount > 0 && (
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={onPublishApproved}>
                    <BookCheck className="h-3.5 w-3.5 mr-1.5" />
                    Publish ({publishReadyCount})
                  </Button>
                )}
                {pendingCount > 0 && (
                  <Button size="sm" className="text-xs h-7" onClick={onApproveAll}>
                    <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                    Approve All ({pendingCount})
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyCanvasState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-20 text-center"
    >
      <div className="rounded-full bg-primary/10 p-6 mb-4">
        <FileQuestion className="h-12 w-12 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No Questions Yet</h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Configure your generation settings and click "Generate" to create AI-powered questions.
        Questions will appear here in real-time.
      </p>
    </motion.div>
  )
}

function GeneratingPreview({
  progress,
  streamingContent,
}: {
  progress: { current: number; total: number }
  streamingContent?: string
}) {
  return (
    <Card className="p-5 bg-card border border-border overflow-hidden max-w-3xl mx-auto w-full rounded-xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-full bg-primary/10">
          <LoadingSpinner size="sm" className="text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium">
            Generating Question {progress.current + 1} of {progress.total}
          </p>
          <p className="text-xs text-muted-foreground">
            {streamingContent ? 'Streaming response...' : 'AI is crafting your question...'}
          </p>
        </div>
      </div>

      {streamingContent ? (
        <div className="relative">
          <StreamingMarkdown content={streamingContent} />
          <span className="inline-block w-2 h-4 bg-primary/80 ml-0.5 animate-pulse" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded animate-pulse w-full" />
            <div className="h-4 bg-muted rounded animate-pulse w-5/6" />
            <div className="h-4 bg-muted rounded animate-pulse w-4/6" />
          </div>
          <div className="space-y-2 pt-2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-5 w-5 rounded-full bg-muted animate-pulse flex-shrink-0" />
                <div className="h-4 bg-muted rounded animate-pulse flex-1" />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

export default QuestionCanvas
