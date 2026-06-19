/**
 * QuestionCard - Focused single-question review card with action bar and quality display
 */
import * as React from 'react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MathText } from '@/components/ui/math-text'
import {
  Check,
  X,
  Scissors,
  Pencil,
  RotateCcw,
  Brain,
  ChevronLeft,
  ChevronRight,
  BookCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuestionCardProps {
  question: {
    question_id: string
    type: string
    difficulty: string
    blooms_level?: string
    question_text: string
    options?: string[]
    correct_answer: string
    explanation?: string
    status?: 'pending' | 'approved' | 'rejected' | 'edited'
    quality_score?: number | null
    published_question_id?: string | null
    published_at?: string | null
    versions?: any[]
    currentVersionIndex?: number
  }
  index: number
  isSelected?: boolean
  isStreaming?: boolean
  onClick?: () => void
  onEdit?: (id: string, updates: Partial<QuestionCardProps['question']>) => void
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onDelete?: (id: string) => void
  onCycleVersion?: (questionId: string, direction: 'prev' | 'next') => void
  onRequestRegenerate?: (questionId: string, defaultMessage: string) => void
}

const difficultyColors: Record<string, string> = {
  easy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  hard: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  EASY: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  MEDIUM: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  HARD: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
}

const typeLabels: Record<string, string> = {
  'multiple-choice': 'MCQ',
  'true-false': 'T/F',
  'short-answer': 'Short',
  essay: 'Essay',
  MCQ: 'MCQ',
  TRUE_FALSE: 'T/F',
  SHORT_ANSWER: 'Short',
  ESSAY: 'Essay',
}

const bloomsLabels: Record<string, string> = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyze: 'Analyze',
  evaluate: 'Evaluate',
  create: 'Create',
  REMEMBER: 'Remember',
  UNDERSTAND: 'Understand',
  APPLY: 'Apply',
  ANALYZE: 'Analyze',
  EVALUATE: 'Evaluate',
  CREATE: 'Create',
}

function QualityBar({ score }: { score: number }) {
  const clampedScore = Math.max(0, Math.min(100, score))
  const barColor =
    clampedScore >= 80
      ? 'bg-emerald-500'
      : clampedScore >= 60
        ? 'bg-amber-500'
        : 'bg-red-500'
  const textColor =
    clampedScore >= 80
      ? 'text-emerald-700 dark:text-emerald-400'
      : clampedScore >= 60
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-red-700 dark:text-red-400'

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground font-medium">Quality</span>
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${clampedScore}%` }}
        />
      </div>
      <span className={cn('text-sm font-bold', textColor)}>{clampedScore}</span>
    </div>
  )
}

export function QuestionCard({
  question,
  index,
  isStreaming = false,
  onEdit,
  onApprove,
  onReject,
  onDelete,
  onCycleVersion,
  onRequestRegenerate,
}: QuestionCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedQuestion, setEditedQuestion] = useState(question.question_text)
  const [editedOptions, setEditedOptions] = useState(question.options || [])
  const [editedCorrectAnswer, setEditedCorrectAnswer] = useState(question.correct_answer)
  const [editedExplanation, setEditedExplanation] = useState(question.explanation || '')

  const hasVersions = question.versions && question.versions.length > 0
  const currentVersion = hasVersions ? (question.currentVersionIndex ?? 0) + 1 : 1
  const totalVersions = hasVersions ? question.versions!.length + 1 : 1

  const handleEditStart = () => {
    setIsEditing(true)
    setEditedQuestion(question.question_text)
    setEditedOptions([...(question.options || [])])
    setEditedCorrectAnswer(question.correct_answer)
    setEditedExplanation(question.explanation || '')
  }

  const handleEditCancel = () => {
    setIsEditing(false)
  }

  const handleEditSave = () => {
    if (onEdit) {
      onEdit(question.question_id, {
        question_text: editedQuestion,
        options: question.options ? editedOptions : undefined,
        correct_answer: editedCorrectAnswer,
        explanation: editedExplanation || undefined,
      })
    }
    setIsEditing(false)
  }

  const handleOptionChange = (idx: number, value: string) => {
    const newOptions = [...editedOptions]
    newOptions[idx] = value
    setEditedOptions(newOptions)
  }

  const questionNumber = String(index + 1).padStart(2, '0')
  const bloomsLevel = question.blooms_level
    ? bloomsLabels[question.blooms_level] || question.blooms_level
    : null

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-xl shadow-sm overflow-hidden max-w-3xl mx-auto w-full',
        isStreaming && 'animate-pulse',
        isEditing && 'ring-2 ring-amber-500',
      )}
    >
      {/* Header Row */}
      <div className="flex items-center gap-2.5 px-6 pt-5 pb-3 flex-wrap">
        <span className="text-sm font-semibold text-foreground tracking-wide">
          Q{questionNumber}
        </span>

        <Badge
          className={cn(
            'text-xs font-medium rounded-full px-2.5 py-0.5 border-0',
            difficultyColors[question.difficulty],
          )}
        >
          {question.difficulty.toLowerCase()}
        </Badge>

        <Badge
          variant="outline"
          className="text-xs font-medium rounded-full px-2.5 py-0.5 bg-muted/50"
        >
          {typeLabels[question.type] || question.type}
        </Badge>

        {bloomsLevel && (
          <Badge
            variant="outline"
            className="text-xs font-medium rounded-full px-2.5 py-0.5 bg-muted/50 gap-1"
          >
            <Brain className="h-3 w-3" />
            {bloomsLevel}
          </Badge>
        )}

        {/* Version cycling */}
        {hasVersions && !isEditing && (
          <div className="flex items-center gap-0.5 ml-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-foreground"
              onClick={() => onCycleVersion?.(question.question_id, 'prev')}
              disabled={currentVersion <= 1}
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <span className="text-[10px] text-muted-foreground min-w-[2.5rem] text-center">
              v{currentVersion}/{totalVersions}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-foreground"
              onClick={() => onCycleVersion?.(question.question_id, 'next')}
              disabled={currentVersion >= totalVersions}
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        )}

        {question.published_question_id && (
          <Badge variant="secondary" className="h-5 gap-1 px-2 text-[10px] uppercase tracking-wide rounded-full">
            <BookCheck className="h-3 w-3" />
            Published
          </Badge>
        )}

        <div className="flex-1" />

        {question.quality_score != null && (
          <QualityBar score={question.quality_score} />
        )}
      </div>

      {/* Question Text */}
      <div className="px-6 pb-4">
        {isEditing ? (
          <div className="mb-3">
            <label className="text-xs text-muted-foreground mb-1 block">Question</label>
            <textarea
              value={editedQuestion}
              onChange={(e) => setEditedQuestion(e.target.value)}
              className="w-full p-3 text-base bg-muted border border-border rounded-lg text-foreground focus:border-primary focus:outline-none resize-y"
              rows={3}
            />
          </div>
        ) : (
          <MathText className="text-base font-semibold text-foreground leading-relaxed" block>
            {question.question_text}
          </MathText>
        )}
      </div>

      {/* Options */}
      {question.options && question.options.length > 0 && (
        <div className="px-6 pb-4 space-y-2.5">
          {question.options.map((option, i) => {
            const optionLetter = String.fromCharCode(65 + i)
            const optionText =
              typeof option === 'string' ? option.replace(/^[A-Za-z][).:-]\s*/, '').trim() : option
            const answerText = question.correct_answer.replace(/^[A-Za-z][).:-]\s*/, '').trim()
            const isCorrect =
              optionLetter === question.correct_answer.charAt(0).toUpperCase() ||
              optionText.toLowerCase() === answerText.toLowerCase()

            return (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors',
                  isCorrect
                    ? 'bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-700'
                    : 'bg-card border-border',
                )}
              >
                <span
                  className={cn(
                    'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium',
                    isCorrect
                      ? 'bg-emerald-500 text-white'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {optionLetter}
                </span>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedOptions[i] || ''}
                    onChange={(e) => handleOptionChange(i, e.target.value)}
                    title={`Option ${optionLetter}`}
                    placeholder={`Option ${optionLetter}`}
                    className="flex-1 p-1.5 text-sm bg-muted border border-border rounded text-foreground focus:border-primary focus:outline-none"
                  />
                ) : (
                  <MathText
                    className={cn(
                      'text-sm flex-1',
                      isCorrect
                        ? 'text-emerald-800 dark:text-emerald-300 font-medium'
                        : 'text-foreground',
                    )}
                  >
                    {optionText}
                  </MathText>
                )}
                {isCorrect && !isEditing && (
                  <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Non-MCQ Answer */}
      {(!question.options || question.options.length === 0) && (
        <div className="px-6 pb-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground font-medium">Answer:</span>
            {isEditing ? (
              <input
                type="text"
                value={editedCorrectAnswer}
                onChange={(e) => setEditedCorrectAnswer(e.target.value)}
                title="Correct answer"
                placeholder="Correct answer"
                className="p-1.5 text-sm bg-muted border border-border rounded text-emerald-700 dark:text-emerald-400 focus:border-primary focus:outline-none"
              />
            ) : (
              <MathText className="font-semibold text-emerald-700 dark:text-emerald-400">
                {question.correct_answer}
              </MathText>
            )}
          </div>
        </div>
      )}

      {/* Explanation */}
      {isEditing ? (
        <div className="px-6 pb-4">
          <label className="text-xs text-muted-foreground mb-1 block">Explanation</label>
          <textarea
            value={editedExplanation}
            onChange={(e) => setEditedExplanation(e.target.value)}
            className="w-full p-3 text-sm bg-muted border border-border rounded-lg text-foreground focus:border-primary focus:outline-none resize-y"
            rows={2}
            placeholder="Add explanation..."
          />
        </div>
      ) : (
        question.explanation && (
          <div className="mx-6 mb-4 border-l-[3px] border-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded-r-lg px-4 py-3">
            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1">
              Explanation
            </p>
            <MathText className="text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
              {question.explanation}
            </MathText>
          </div>
        )
      )}

      {/* Action Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-muted/20">
        {isEditing ? (
          <>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleEditCancel}
                className="gap-1.5 text-xs"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
            <Button
              size="sm"
              onClick={handleEditSave}
              className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Check className="h-3.5 w-3.5" />
              Save Changes
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              {question.status !== 'rejected' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReject?.(question.question_id)}
                  className="gap-1.5 text-xs h-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  Cut
                  <kbd className="ml-0.5 text-[10px] text-muted-foreground border border-border rounded px-1 py-0.5 bg-background">
                    J
                  </kbd>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleEditStart}
                className="gap-1.5 text-xs h-8"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
                <kbd className="ml-0.5 text-[10px] text-muted-foreground border border-border rounded px-1 py-0.5 bg-background">
                  E
                </kbd>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRequestRegenerate?.(question.question_id, 'Regenerate question with adjustments: ')}
                className="gap-1.5 text-xs h-8"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Redo
                <kbd className="ml-0.5 text-[10px] text-muted-foreground border border-border rounded px-1 py-0.5 bg-background">
                  R
                </kbd>
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {question.status === 'approved' && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium mr-1">
                  <Check className="h-3.5 w-3.5" />
                  Approved
                </span>
              )}
              {question.status === 'rejected' && (
                <span className="flex items-center gap-1 text-xs text-red-500 font-medium mr-1">
                  <X className="h-3.5 w-3.5" />
                  Cut
                </span>
              )}
              {question.status !== 'approved' && (
                <Button
                  size="sm"
                  onClick={() => onApprove?.(question.question_id)}
                  className="gap-1.5 text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Check className="h-3.5 w-3.5" />
                  Approve
                  <kbd className="ml-0.5 text-[10px] text-emerald-300 border border-emerald-400/40 rounded px-1 py-0.5">
                    Space &middot; K
                  </kbd>
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default QuestionCard
