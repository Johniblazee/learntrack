import type { Question, QuestionOptionRecord } from './types'

const stripOptionPrefix = (value: string) => value.replace(/^[A-Za-z][).:-]\s*/, '').trim()

const normalizeOptionsAndAnswer = (
  options: Array<string | QuestionOptionRecord> | undefined,
  answer: string | undefined,
) => {
  const normalizedOptions = (options || [])
    .map((option) => {
      if (typeof option === 'string') {
        return option.trim()
      }

      return String(option?.text || '').trim()
    })
    .filter(Boolean)

  const explicitAnswer = String(answer || '').trim()
  const optionRecordMatch = (options || []).find(
    (option): option is QuestionOptionRecord =>
      typeof option !== 'string' && option?.is_correct === true && typeof option?.text === 'string',
  )

  let resolvedAnswer = explicitAnswer || String(optionRecordMatch?.text || '').trim()

  if (resolvedAnswer.length === 1 && /^[A-Za-z]$/.test(resolvedAnswer)) {
    const index = resolvedAnswer.toUpperCase().charCodeAt(0) - 65
    if (index >= 0 && index < normalizedOptions.length) {
      resolvedAnswer = stripOptionPrefix(normalizedOptions[index])
    }
  }

  const strippedAnswer = stripOptionPrefix(resolvedAnswer)
  const displayOptions = normalizedOptions.map((option) => stripOptionPrefix(option))
  return {
    options: displayOptions,
    correctAnswer: strippedAnswer,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mapQuestionFromApi = (q: any): Question => {
  const normalized = normalizeOptionsAndAnswer(
    q.options,
    q.correct_answer || q.correctAnswer,
  )

  return {
    id: q.question_id || q.id,
    question_id: q.question_id,
    session_id: q.session_id,
    text: q.question_text || q.text,
    question_text: q.question_text,
    type: q.type,
    difficulty: q.difficulty,
    blooms_level: q.blooms_level,
    subject: q.subject || 'Generated',
    topic: q.topic || q.session_prompt || 'AI Generated',
    options: normalized.options.length > 0 ? normalized.options : undefined,
    correctAnswer: normalized.correctAnswer,
    correct_answer: q.correct_answer,
    explanation: q.explanation || '',
    points: Number(q.points || 1),
    tags: q.tags || [],
    status: q.status?.toLowerCase() || 'pending',
    createdBy: q.created_by || 'AI Generator',
    createdAt: q.session_created_at || q.created_at || new Date().toISOString(),
    session_created_at: q.session_created_at,
    reviewedBy: q.reviewed_by,
    reviewedAt: q.reviewed_at,
    reviewComments: q.review_comments,
    rejectionReason: q.rejection_reason,
    publishedQuestionId: q.published_question_id,
    publishedAt: q.published_at,
    rating: q.rating,
    usageCount: Number(q.usage_count || 0),
    successRate: Number(q.success_rate || 0),
  }
}
