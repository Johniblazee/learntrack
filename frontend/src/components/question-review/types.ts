export interface Question {
  id: string
  question_id?: string
  session_id?: string
  text: string
  question_text?: string
  type: string
  difficulty: string
  blooms_level?: string
  subject: string
  topic: string
  options?: string[]
  correctAnswer: string
  correct_answer?: string
  explanation: string
  points: number
  tags: string[]
  status: 'pending' | 'approved' | 'rejected' | 'needs-revision' | 'PENDING' | 'APPROVED' | 'REJECTED'
  createdBy: string
  createdAt: string
  session_created_at?: string
  reviewedBy?: string
  reviewedAt?: string
  reviewComments?: string
  rejectionReason?: string
  publishedQuestionId?: string
  publishedAt?: string
  rating?: number
  usageCount: number
  successRate: number
}

export interface ReviewStats {
  totalQuestions: number
  pendingReview: number
  approved: number
  rejected: number
  averageRating: number
}

export interface GenerationStats {
  total_generated: number
  this_month: number
  success_rate: number
  avg_quality: number
  total_sessions: number
  month_sessions: number
  approved_questions: number
  rejected_questions: number
}

export interface SubjectRecord {
  _id?: string
  id?: string
  name?: string
}

export interface QuestionOptionRecord {
  text?: string
  is_correct?: boolean
}
