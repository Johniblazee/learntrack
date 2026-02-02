/**
 * QuestionCard - Card for displaying questions with selection, inline editing, and version cycling
 */
import * as React from 'react'
import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Check, X, Trash2, RefreshCw, Edit3 } from 'lucide-react'
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
    status?: 'pending' | 'approved' | 'rejected'
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
  easy: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  hard: 'bg-red-500/20 text-red-400 border-red-500/30',
  EASY: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  MEDIUM: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  HARD: 'bg-red-500/20 text-red-400 border-red-500/30',
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

export function QuestionCard({
  question,
  index,
  isSelected = false,
  isStreaming = false,
  onClick,
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
  const currentVersion = hasVersions
    ? (question.currentVersionIndex ?? 0) + 1
    : 1
  const totalVersions = hasVersions ? question.versions!.length + 1 : 1

  const handleCardClick = (e: React.MouseEvent) => {
    if (isEditing) return
    if (onClick) {
      onClick()
    }
  }

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

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

  const handleRegenerateClick = (e: React.MouseEvent) => {
    handleActionClick(e)
    if (onClick) {
      onClick()
    }
    if (onRequestRegenerate) {
      onRequestRegenerate(
        question.question_id,
        "Regenerate question with adjustments: "
      )
    }
  }

  const handleOptionChange = (idx: number, value: string) => {
    const newOptions = [...editedOptions]
    newOptions[idx] = value
    setEditedOptions(newOptions)
  }

  return (
    <Card
      className={cn(
        'relative cursor-pointer transition-all duration-200 overflow-hidden',
        'bg-zinc-900 border-zinc-800',
        isSelected && 'border-2 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]',
        !isSelected && 'hover:border-zinc-700 hover:bg-zinc-900/80',
        isStreaming && 'animate-pulse',
        isEditing && 'border-2 border-amber-500'
      )}
      onClick={handleCardClick}
    >
      <CardContent className="p-4">
        {/* Header Row */}
        <div className="flex items-center gap-3 mb-3">
          {/* Question Number */}
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
            <span className="text-sm font-semibold text-zinc-300">{index}</span>
          </div>

          {/* Badges */}
          <Badge
            variant="outline"
            className={cn(
              'text-xs font-medium border',
              difficultyColors[question.difficulty]
            )}
          >
            {question.difficulty}
          </Badge>

          <Badge
            variant="outline"
            className="text-xs font-medium bg-zinc-800 text-zinc-300 border-zinc-700"
          >
            {typeLabels[question.type] || question.type}
          </Badge>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Version Cycling */}
          {hasVersions && !isEditing && (
            <div
              className="flex items-center gap-1"
              onClick={handleActionClick}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                onClick={() =>
                  onCycleVersion?.(question.question_id, 'prev')
                }
                disabled={currentVersion <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-zinc-500 min-w-[3rem] text-center">
                {currentVersion}/{totalVersions}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                onClick={() =>
                  onCycleVersion?.(question.question_id, 'next')
                }
                disabled={currentVersion >= totalVersions}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Status & Actions */}
          <div className="flex items-center gap-1" onClick={handleActionClick}>
            {/* Edit Mode Buttons */}
            {isEditing ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                  onClick={handleEditSave}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  onClick={handleEditCancel}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                {/* Status Indicators */}
                {question.status === 'approved' && (
                  <div className="flex items-center gap-1 text-emerald-400">
                    <Check className="h-4 w-4" />
                  </div>
                )}
                {question.status === 'rejected' && (
                  <div className="flex items-center gap-1 text-red-400">
                    <X className="h-4 w-4" />
                  </div>
                )}

                {/* Edit Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10"
                  onClick={handleEditStart}
                >
                  <Edit3 className="h-4 w-4" />
                </Button>

                {/* Regenerate Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10"
                  onClick={handleRegenerateClick}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>

                {/* Approve Button */}
                {question.status !== 'approved' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                    onClick={() => onApprove?.(question.question_id)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                )}

                {/* Reject Button */}
                {question.status !== 'rejected' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                    onClick={() => onReject?.(question.question_id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}

                {/* Delete Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                  onClick={() => onDelete?.(question.question_id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Question Content */}
        <div className="pl-11">
          {/* Question Text - Editable or Read-only */}
          {isEditing ? (
            <div className="mb-4">
              <label className="text-xs text-zinc-500 mb-1 block">Question</label>
              <textarea
                value={editedQuestion}
                onChange={(e) => setEditedQuestion(e.target.value)}
                className="w-full p-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:border-blue-500 focus:outline-none resize-y"
                rows={3}
              />
            </div>
          ) : (
            <p className="text-sm text-zinc-200 leading-relaxed">
              {question.question_text}
            </p>
          )}

          {/* Options for multiple choice */}
          {question.options && question.options.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {question.options.map((option, i) => {
                const optionLetter = option.charAt(0).toUpperCase()
                const answerLetter = question.correct_answer
                  .charAt(0)
                  .toUpperCase()
                const isCorrect = optionLetter === answerLetter

                return (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-2 text-sm rounded px-2 py-1.5',
                      isCorrect
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'text-zinc-400'
                    )}
                  >
                    <span
                      className={cn(
                        'w-5 h-5 rounded flex items-center justify-center text-xs',
                        isCorrect
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-zinc-800 text-zinc-500'
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedOptions[i] || ''}
                        onChange={(e) => handleOptionChange(i, e.target.value)}
                        className="flex-1 p-1 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:border-blue-500 focus:outline-none"
                      />
                    ) : (
                      <span>{option}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Answer */}
          <div className="mt-3 pt-2 border-t border-zinc-800">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Answer:</span>
              {isEditing ? (
                <input
                  type="text"
                  value={editedCorrectAnswer}
                  onChange={(e) => setEditedCorrectAnswer(e.target.value)}
                  className="p-1 text-sm bg-zinc-800 border border-zinc-700 rounded text-emerald-400 focus:border-blue-500 focus:outline-none"
                />
              ) : (
                <span className="text-sm font-medium text-emerald-400">
                  {question.correct_answer}
                </span>
              )}
            </div>
          </div>

          {/* Explanation */}
          {isEditing ? (
            <div className="mt-3">
              <label className="text-xs text-zinc-500 mb-1 block">Explanation</label>
              <input
                type="text"
                value={editedExplanation}
                onChange={(e) => setEditedExplanation(e.target.value)}
                className="w-full p-1 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-400 focus:border-blue-500 focus:outline-none"
                placeholder="Add explanation..."
              />
            </div>
          ) : question.explanation && (
            <div className="mt-2 text-xs text-zinc-500 italic">
              {question.explanation}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default QuestionCard
