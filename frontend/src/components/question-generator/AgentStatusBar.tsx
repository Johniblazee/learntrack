/**
 * AgentStatusBar - Displays the real-time status of the question generation agent.
 * Visualizes the agent's thinking steps and current action.
 */
import { motion, AnimatePresence } from 'motion/react'
import { FileSearch, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AgentStatusBarProps {
  isGenerating: boolean
  currentAction: string | null
  thinkingSteps: string[]
  progress: { current: number; total: number }
  foundSources: Array<{ id: string; title: string }>
}

export function AgentStatusBar({
  isGenerating,
  currentAction,
  thinkingSteps,
  progress,
  foundSources,
}: AgentStatusBarProps) {
  const lastThinkingStep = thinkingSteps[thinkingSteps.length - 1]
  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  if (!isGenerating && progress.current === 0) {
    return null
  }

  return (
    <div className="relative overflow-hidden rounded-lg border bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 p-3">
      {/* Progress bar background */}
      <div className="absolute inset-0 bg-primary/5" />
      <motion.div
        className="absolute inset-y-0 left-0 bg-primary/10"
        initial={{ width: 0 }}
        animate={{ width: `${progressPercent}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />

      {/* Content */}
      <div className="relative z-10 flex items-center gap-3">
        {/* Status Icon */}
        <AnimatePresence mode="wait">
          <motion.div
            key={isGenerating ? 'generating' : 'complete'}
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 180 }}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full',
              isGenerating ? 'bg-primary/20 text-primary' : 'bg-green-500/20 text-green-500'
            )}
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Status Text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {isGenerating ? 'Generating Questions' : 'Generation Complete'}
            </span>
            {progress.total > 0 && (
              <span className="text-xs text-muted-foreground">
                ({progress.current}/{progress.total})
              </span>
            )}
          </div>

          {/* Current Action / Thinking */}
          <AnimatePresence mode="wait">
            {(currentAction || lastThinkingStep) && (
              <motion.p
                key={currentAction || lastThinkingStep}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="text-xs text-muted-foreground truncate"
              >
                {currentAction || lastThinkingStep}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Sources Found */}
        {foundSources.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileSearch className="w-3 h-3" />
            <span>{foundSources.length} sources</span>
          </div>
        )}
      </div>

      {/* Animated gradient line */}
      {isGenerating && (
        <motion.div
          className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          style={{ width: '50%' }}
        />
      )}
    </div>
  )
}

export default AgentStatusBar

