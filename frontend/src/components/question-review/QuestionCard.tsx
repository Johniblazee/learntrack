import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { MathText } from '@/components/ui/math-text'
import { DIFFICULTIES } from '@/lib/constants'
import { CheckCircle, XCircle, Clock, AlertTriangle, Star, MessageSquare } from 'lucide-react'
import type { Question } from './types'

const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved':
      return 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
    case 'rejected':
      return 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
    case 'pending':
      return 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400'
    case 'needs-revision':
      return 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'approved':
      return <CheckCircle className="w-4 h-4" />
    case 'rejected':
      return <XCircle className="w-4 h-4" />
    case 'pending':
      return <Clock className="w-4 h-4" />
    case 'needs-revision':
      return <AlertTriangle className="w-4 h-4" />
    default:
      return <Clock className="w-4 h-4" />
  }
}

const getDifficultyColor = (difficulty: string) => {
  switch (difficulty.toLowerCase()) {
    case DIFFICULTIES.EASY:
      return 'bg-emerald-500/20 text-emerald-400'
    case DIFFICULTIES.MEDIUM:
      return 'bg-amber-500/20 text-amber-400'
    case DIFFICULTIES.HARD:
      return 'bg-red-500/20 text-red-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

const renderStars = (rating: number) => {
  return Array.from({ length: 5 }, (_, i) => (
    <Star
      key={i}
      className={`w-4 h-4 ${i < rating ? 'text-primary fill-current' : 'text-muted-foreground/30'}`}
    />
  ))
}

interface QuestionCardProps {
  question: Question
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  showPublishStatus?: boolean
  showCreatedDate?: boolean
  reviewCommentStyle?: 'warning' | 'error'
  actions?: React.ReactNode
}

export default function QuestionCard({
  question,
  selectable,
  selected,
  onToggleSelect,
  showPublishStatus,
  showCreatedDate,
  reviewCommentStyle = 'warning',
  actions,
}: QuestionCardProps) {
  return (
    <Card className="border-border hover:shadow-lg transition-all duration-200 overflow-hidden">
      <CardContent className="p-0">
        {/* Header with metadata */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-muted/30 border-b border-border">
          <div className="flex items-center gap-3 flex-wrap">
            {selectable && (
              <Checkbox
                checked={selected}
                onCheckedChange={() => onToggleSelect?.()}
                onClick={(e) => e.stopPropagation()}
                className="w-5 h-5"
              />
            )}
            <Badge className={`border-0 ${getStatusColor(question.status)}`}>
              <div className="flex items-center gap-1">
                {getStatusIcon(question.status)}
                <span className="capitalize">{question.status.replace('-', ' ')}</span>
              </div>
            </Badge>
            {showPublishStatus && question.publishedQuestionId && (
              <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-0">
                Published
              </Badge>
            )}
            <Badge className={getDifficultyColor(question.difficulty)}>
              <span className="capitalize">{question.difficulty}</span>
            </Badge>
            <Badge variant="outline" className="border-border bg-background">
              {question.type}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">{question.points} pts</span>
            {question.rating && (
              <div className="flex items-center gap-1">
                {renderStars(question.rating)}
              </div>
            )}
            {showCreatedDate && (
              <span className="text-xs text-muted-foreground">
                {new Date(question.createdAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {/* Question text */}
        <div className="px-6 py-6">
          <div className="text-lg font-medium text-foreground leading-relaxed">
            <MathText className="text-lg">{question.text}</MathText>
          </div>
        </div>

        {/* Options */}
        {question.options && (
          <div className="px-6 pb-6">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Answer Options
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {question.options.map((option, optIndex) => (
                <div
                  key={optIndex}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    option === question.correctAnswer
                      ? 'bg-green-50 dark:bg-green-950/30 border-green-500 dark:border-green-700'
                      : 'bg-background border-border hover:border-muted-foreground/30'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="font-bold text-foreground text-lg flex-shrink-0">
                      {String.fromCharCode(65 + optIndex)}.
                    </span>
                    <span className="text-foreground flex-1">
                      <MathText className="text-inherit">{option}</MathText>
                    </span>
                    {option === question.correctAnswer && (
                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-500 flex-shrink-0" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info section */}
        <div className="px-6 pb-6">
          <div className="bg-muted/50 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Subject & Topic
              </p>
              <p className="text-sm font-medium text-foreground">
                {question.subject}{question.topic ? ` — ${question.topic}` : ''}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Correct Answer
              </p>
              <div className="text-sm font-semibold text-green-700 dark:text-green-400">
                <MathText className="text-inherit text-sm">{question.correctAnswer}</MathText>
              </div>
            </div>
            {showPublishStatus ? (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Publish Status
                </p>
                <p className="text-sm font-medium text-foreground">
                  {question.publishedQuestionId
                    ? question.publishedAt
                      ? `Published on ${new Date(question.publishedAt).toLocaleDateString()}`
                      : 'Published'
                    : 'Ready to publish'}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Created By
                </p>
                <p className="text-sm font-medium text-foreground">
                  {question.createdBy}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Explanation */}
        {question.explanation && (
          <div className="px-6 pb-6">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Explanation
            </h4>
            <div className="bg-primary/5 border-l-4 border-primary rounded-r-lg p-4">
              <div className="text-foreground leading-relaxed">
                <MathText className="text-inherit">{question.explanation}</MathText>
              </div>
            </div>
          </div>
        )}

        {/* Tags */}
        {question.tags.length > 0 && (
          <div className="px-6 pb-6">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Tags
            </h4>
            <div className="flex flex-wrap gap-2">
              {question.tags.map((tag, tagIndex) => (
                <Badge
                  key={tagIndex}
                  variant="secondary"
                  className="text-xs bg-primary/10 text-primary border-0 font-medium"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Review Comments */}
        {question.reviewComments && (
          <div className="px-6 pb-6">
            <div className={
              reviewCommentStyle === 'error'
                ? 'bg-red-50 dark:bg-red-950/20 p-4 rounded-lg border border-red-200 dark:border-red-800'
                : 'bg-yellow-50 dark:bg-yellow-950/30 p-4 rounded-lg border-2 border-yellow-200 dark:border-yellow-800'
            }>
              <h4 className="font-semibold text-foreground mb-2 flex items-center">
                <MessageSquare className={`w-4 h-4 mr-2 ${
                  reviewCommentStyle === 'error'
                    ? 'text-red-600 dark:text-red-500'
                    : 'text-yellow-600 dark:text-yellow-500'
                }`} />
                {reviewCommentStyle === 'error' ? 'Rejection Reason' : 'Review Comments'}
              </h4>
              <div className="text-foreground text-sm leading-relaxed">
                <MathText className="text-inherit text-sm">{question.reviewComments}</MathText>
              </div>
              {question.reviewedBy && (
                <p className={`text-xs text-muted-foreground mt-3 pt-3 border-t ${
                  reviewCommentStyle === 'error'
                    ? 'border-red-200 dark:border-red-800'
                    : 'border-yellow-200 dark:border-yellow-800'
                }`}>
                  Reviewed by {question.reviewedBy}
                  {question.reviewedAt && ` · ${new Date(question.reviewedAt).toLocaleDateString()}`}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Action buttons slot */}
        {actions && (
          <div className="px-6 py-4 bg-muted/20 border-t border-border">
            {actions}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
