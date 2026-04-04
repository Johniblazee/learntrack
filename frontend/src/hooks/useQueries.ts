/**
 * Custom React Query hooks for data fetching
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApiClient } from '@/lib/api-client'

// Pagination types
export interface PaginationMeta {
  page: number
  per_page: number
  total: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

export interface PaginatedResponse<T> {
  items: T[]
  meta: PaginationMeta
}

export type JsonRecord = Record<string, unknown>

export interface NotificationItem {
  id?: string
  _id?: string
  title?: string
  message?: string
  notification_type?: string
  created_at?: string
  is_read?: boolean
  action_url?: string | null
}

export interface UnreadNotificationCountResponse {
  unread_count?: number
}

export interface AssignmentSummaryRecord {
  id?: string
  _id?: string
  title?: string
  subject_name?: string
  subject?: string | { name?: string }
  subject_id?: string | { _id?: string; name?: string } | null
  due_date?: string | null
  dueDate?: string | null
  question_count?: number
  questionCount?: number
  questions?: unknown[]
  completed_questions?: number
  completedQuestions?: number
  status?: string
  progress_percent?: number
  progressPercent?: number
  best_score?: number
  score?: number
  feedback?: string
  review_available?: boolean
  submitted_at?: string | null
  graded_at?: string | null
}

export interface StudentActivityRecord {
  description?: string
  activity_type?: string
  related_entity_type?: string
  created_at?: string
}

export interface ParentUpcomingAssignmentRecord {
  title?: string
  subject?: string
  due_date?: string | null
  is_overdue?: boolean
}

export interface ParentProgressViewRecord {
  child_id?: string
  child_name?: string
  upcoming_assignments?: ParentUpcomingAssignmentRecord[]
}

export interface StudentDashboardStatsResponse {
  total_assignments: number
  completed: number
  pending: number
  overall_average: number
  current_grade: string
}

export interface StudentSubjectPerformance {
  subject: string
  score: number
  assignments: number
  completed?: number
}

export interface StudentRecentSubmission {
  assignment_id?: string
  id?: string
  assignment_title?: string
  subject?: string
  score?: number | null
  submitted_at?: string | null
}

export interface StudentWeeklyProgress {
  week: string
  completed: number
  assigned: number
}

export interface StudentProgressAnalyticsResponse {
  total_assignments: number
  completed_assignments: number
  pending_assignments: number
  overdue_assignments: number
  average_score: number | null
  total_time_spent: number
  subject_performance: StudentSubjectPerformance[]
  recent_submissions: StudentRecentSubmission[]
  weekly_progress: StudentWeeklyProgress[]
}

export interface StudentMaterialRecord {
  id?: string
  _id?: string
  title?: string
  description?: string
  material_type?: string
  file_url?: string | null
  file_size?: number | null
  subject_name?: string
  subject?: string | { name?: string }
  subject_id?: string | { name?: string } | null
  topic?: string
  created_at?: string | null
}

// Student interface
export interface Student {
  _id: string
  clerk_id?: string | null
  name: string
  email: string
  slug?: string
  tutor_id: string
  group_ids?: string[]
  is_active: boolean
  created_at: string
  updated_at: string
  account_status?: 'provisioned' | 'invited' | 'claimed' | null
  claimed_at?: string | null
  last_invited_at?: string | null
  invitation_sent_count?: number
  student_profile?: {
    averageScore?: number
    grade?: string | null
    phone?: string | null
    notes?: string | null
  } | null
  parent_name?: string | null
}

/**
 * Hook to fetch all students with pagination
 */
export function useStudents(page: number = 1, perPage: number = 10) {
  const client = useApiClient()

  return useQuery<PaginatedResponse<Student>>({
    queryKey: ['students', page, perPage],
    queryFn: async () => {
      const response = await client.get(`/students?page=${page}&per_page=${perPage}`)
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data as PaginatedResponse<Student>
    },
  })
}

/**
 * Hook to fetch a single student by slug
 */
export function useStudent(slug: string | undefined) {
  const client = useApiClient()

  return useQuery({
    queryKey: ['students', slug],
    queryFn: async () => {
      if (!slug) throw new Error('Student slug is required')
      const response = await client.get(`/students/by-slug/${slug}`)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!slug, // Only run query if slug is provided
  })
}

/**
 * Hook to delete a student
 */
export function useDeleteStudent() {
  const client = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (studentClerkId: string) => {
      const response = await client.delete(`/students/${studentClerkId}`)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: () => {
      // Invalidate students list to refetch
      queryClient.invalidateQueries({ queryKey: ['students'] })
    },
  })
}

/**
 * Hook to fetch student assignments with pagination
 */
export function useStudentAssignments(
  studentId: string | undefined,
  status?: string,
  page: number = 1,
  perPage: number = 10
) {
  const client = useApiClient()

  return useQuery<PaginatedResponse<AssignmentSummaryRecord>>({
    queryKey: ['assignments', 'student', studentId, status, page, perPage],
    queryFn: async () => {
      if (!studentId) throw new Error('Student ID is required')
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
      })
      if (status) params.append('status', status)

      const response = await client.get(`/assignments/student/${studentId}?${params.toString()}`)
      if (response.error) throw new Error(response.error)
      return response.data as PaginatedResponse<AssignmentSummaryRecord>
    },
    enabled: !!studentId,
  })
}

/**
 * Hook to fetch student groups
 */
export function useStudentGroups(studentId: string | undefined) {
  const client = useApiClient()
  
  return useQuery({
    queryKey: ['groups', 'student', studentId],
    queryFn: async () => {
      if (!studentId) throw new Error('Student ID is required')
      const response = await client.get(`/groups/student/${studentId}`)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studentId,
  })
}

/**
 * Hook to fetch student activities with pagination
 */
export function useStudentActivities(
  studentId: string | undefined,
  page: number = 1,
  perPage: number = 10
) {
  const client = useApiClient()

  return useQuery<PaginatedResponse<JsonRecord>>({
    queryKey: ['activities', 'student', studentId, page, perPage],
    queryFn: async () => {
      if (!studentId) throw new Error('Student ID is required')
      const response = await client.get(`/activity/student/${studentId}?page=${page}&per_page=${perPage}`)
      if (response.error) throw new Error(response.error)
      return response.data as PaginatedResponse<JsonRecord>
    },
    enabled: !!studentId,
  })
}

/**
 * Hook to fetch student progress analytics
 */
export function useStudentProgress(studentId: string | undefined) {
  const client = useApiClient()
  
  return useQuery({
    queryKey: ['progress', 'student', studentId],
    queryFn: async () => {
      if (!studentId) throw new Error('Student ID is required')
      const response = await client.get(`/progress/student/${studentId}/analytics`)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studentId,
  })
}

/**
 * Hook to fetch notifications with pagination
 * Uses polling instead of WebSocket for real-time updates
 */
export function useNotifications(
  page: number = 1,
  perPage: number = 10,
  unreadOnly: boolean = false
) {
  const client = useApiClient()

  return useQuery<PaginatedResponse<NotificationItem>>({
    queryKey: ['notifications', page, perPage, unreadOnly],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
        unread_only: unreadOnly.toString(),
      })
      const response = await client.get(`/notifications?${params.toString()}`)
      if (response.error) throw new Error(response.error)
      return response.data as PaginatedResponse<NotificationItem>
    },
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    // refetchInterval removed — backend WebSocket events invalidate this query (C3)
  })
}

/**
 * Hook to fetch unread notification count
 */
export function useUnreadNotificationCount() {
  const client = useApiClient()

  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const response = await client.get('/notifications/unread-count')
      if (response.error) throw new Error(response.error)
      return response.data
    },
    staleTime: 10 * 1000,
    refetchOnWindowFocus: true,
    // refetchInterval removed — backend WebSocket events invalidate this query (C3)
  })
}

/**
 * Hook to mark notification as read
 */
export function useMarkNotificationRead() {
  const client = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await client.put(`/notifications/${notificationId}/read`, {})
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: () => {
      // Invalidate and refetch notifications
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] })
    },
  })
}

/**
 * Hook to mark all notifications as read
 */
export function useMarkAllNotificationsRead() {
  const client = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await client.put('/notifications/mark-all-read', {})
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] })
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
    },
  })
}

// ============================================
// Dashboard Queries
// ============================================

/**
 * Hook to fetch dashboard statistics
 */
export function useDashboardStats() {
  const client = useApiClient()

  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      const response = await client.get('/dashboard/stats')
      if (response.error) throw new Error(response.error)
      return response.data
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  })
}

/**
 * Hook to fetch top performers
 */
export function useTopPerformers() {
  const client = useApiClient()

  return useQuery({
    queryKey: ['dashboard', 'top-performers'],
    queryFn: async () => {
      const response = await client.get('/dashboard/top-performers')
      if (response.error) throw new Error(response.error)
      return response.data as Array<{
        name: string
        subject: string
        score: number
        trend: string
        avatar: string
      }>
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  })
}

/**
 * Hook to fetch recent activity
 */
export function useRecentActivity(limit: number = 10) {
  const client = useApiClient()

  return useQuery({
    queryKey: ['dashboard', 'recent-activity', limit],
    queryFn: async () => {
      const response = await client.get(`/dashboard/recent-activity?limit=${limit}`)
      if (response.error) throw new Error(response.error)
      return response.data as Array<{
        student: string
        action: string
        assignment: string
        time: string
        type: string
        created_at: string
      }>
    },
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    // refetchInterval removed — backend WebSocket events invalidate this query (C3)
  })
}

/**
 * Hook to fetch performance chart data
 */
export function usePerformanceChart(days: number = 30) {
  const client = useApiClient()

  return useQuery({
    queryKey: ['dashboard', 'performance-chart', days],
    queryFn: async () => {
      const response = await client.get(`/dashboard/performance-chart?days=${days}`)
      if (response.error) throw new Error(response.error)
      return response.data as Array<{
        period: string
        performance: number
        [key: string]: string | number // For subject-specific data
      }>
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ============================================
// Assignment Queries
// ============================================

/**
 * Hook to fetch tutor assignments with pagination
 */
export function useAssignments(
  page: number = 1,
  perPage: number = 20,
  filters?: { subjectId?: string; status?: string }
) {
  const client = useApiClient()

  return useQuery<PaginatedResponse<JsonRecord>>({
    queryKey: ['assignments', page, perPage, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
      })
      if (filters?.subjectId) params.append('subject_id', filters.subjectId)
      if (filters?.status) params.append('status', filters.status)

      const response = await client.get(`/assignments?${params.toString()}`)
      if (response.error) throw new Error(response.error)
      return response.data as PaginatedResponse<JsonRecord>
    },
  })
}

/**
 * Hook to fetch current student's assignments
 */
export function useMyAssignments() {
  const client = useApiClient()

  return useQuery<AssignmentSummaryRecord[]>({
    queryKey: ['assignments', 'my'],
    queryFn: async () => {
      const perPage = 100
      let page = 1
      let totalPages = 1
      const items: AssignmentSummaryRecord[] = []

      while (page <= totalPages) {
        const response = await client.get(
          `/assignments/student/me?page=${page}&per_page=${perPage}`
        )
        if (response.error) throw new Error(response.error)

        const payload = response.data as PaginatedResponse<AssignmentSummaryRecord> | AssignmentSummaryRecord[]
        const pageItems = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.items)
            ? payload.items
            : []

        items.push(...pageItems)
        totalPages = Array.isArray(payload) ? 1 : Number(payload?.meta?.total_pages || 1)
        page += 1
      }

      return items
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchInterval: 90 * 1000,
  })
}

// ============================================
// Subject Queries
// ============================================

/**
 * Hook to fetch all subjects
 */
export function useSubjects() {
  const client = useApiClient()

  return useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const response = await client.get('/subjects')
      if (response.error) throw new Error(response.error)
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - subjects don't change often
  })
}

export function useSubjectStats(subjectId: string | undefined) {
  const client = useApiClient()

  return useQuery({
    queryKey: ['subjects', subjectId, 'stats'],
    queryFn: async () => {
      const response = await client.get(`/subjects/${subjectId}/stats`)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!subjectId,
    staleTime: 60 * 1000,
  })
}

export function useCreateSubject() {
  const client = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const response = await client.post('/subjects', data)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
    },
  })
}

export function useUpdateSubject() {
  const client = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; description?: string }) => {
      const response = await client.put(`/subjects/${id}`, data)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
    },
  })
}

export function useDeleteSubject() {
  const client = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await client.delete(`/subjects/${id}`)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
    },
  })
}

export function useAddTopic() {
  const client = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ subjectId, topic }: { subjectId: string; topic: string }) => {
      const response = await client.post(`/subjects/${subjectId}/topics/${encodeURIComponent(topic)}`, {})
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      queryClient.invalidateQueries({ queryKey: ['subjects', variables.subjectId, 'stats'] })
      queryClient.invalidateQueries({ queryKey: ['topics'] })
    },
  })
}

export function useRemoveTopic() {
  const client = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ subjectId, topic }: { subjectId: string; topic: string }) => {
      const response = await client.delete(`/subjects/${subjectId}/topics/${encodeURIComponent(topic)}`)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      queryClient.invalidateQueries({ queryKey: ['subjects', variables.subjectId, 'stats'] })
      queryClient.invalidateQueries({ queryKey: ['topics'] })
    },
  })
}

/**
 * Hook to fetch all topics
 */
export function useTopics(subjectId?: string) {
  const client = useApiClient()

  return useQuery({
    queryKey: ['topics', subjectId],
    queryFn: async () => {
      const url = subjectId ? `/topics?subject_id=${subjectId}` : '/topics'
      const response = await client.get(url)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - topics don't change often
  })
}

// ============================================
// Question Queries
// ============================================

/**
 * Hook to fetch questions with pagination
 */
export function useQuestions(
  page: number = 1,
  perPage: number = 20,
  filters?: { subjectId?: string; topic?: string; difficulty?: string; status?: string }
) {
  const client = useApiClient()

  return useQuery<PaginatedResponse<JsonRecord>>({
    queryKey: ['questions', page, perPage, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
      })
      if (filters?.subjectId) params.append('subject_id', filters.subjectId)
      if (filters?.topic) params.append('topic', filters.topic)
      if (filters?.difficulty) params.append('difficulty', filters.difficulty)
      if (filters?.status) params.append('status', filters.status)

      const response = await client.get(`/questions?${params.toString()}`)
      if (response.error) throw new Error(response.error)
      return response.data as PaginatedResponse<JsonRecord>
    },
  })
}

/**
 * Hook to fetch pending questions for review
 */
export function usePendingQuestions(page: number = 1, perPage: number = 20) {
  const client = useApiClient()

  return useQuery<PaginatedResponse<JsonRecord>>({
    queryKey: ['questions', 'pending', page, perPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
      })
      const response = await client.get(`/questions/pending?${params.toString()}`)
      if (response.error) throw new Error(response.error)
      return response.data as PaginatedResponse<JsonRecord>
    },
  })
}

// ============================================
// Material Queries
// ============================================

/**
 * Hook to fetch materials with pagination
 */
export function useMaterials(
  page: number = 1,
  perPage: number = 20,
  filters?: { subjectId?: string; materialType?: string; status?: string }
) {
  const client = useApiClient()

  return useQuery<PaginatedResponse<JsonRecord>>({
    queryKey: ['materials', page, perPage, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
      })
      if (filters?.subjectId) params.append('subject_id', filters.subjectId)
      if (filters?.materialType) params.append('material_type', filters.materialType)
      if (filters?.status) params.append('status', filters.status)

      const response = await client.get(`/materials?${params.toString()}`)
      if (response.error) throw new Error(response.error)
      return response.data as PaginatedResponse<JsonRecord>
    },
  })
}

// ============================================
// Group Queries
// ============================================

/**
 * Hook to fetch all groups
 */
export function useGroups(limit: number = 500) {
  const client = useApiClient()

  return useQuery({
    queryKey: ['groups', limit],
    queryFn: async () => {
      const response = await client.get(`/groups/?limit=${limit}`)
      if (response.error) throw new Error(response.error)
      return response.data
    },
  })
}

// ============================================
// Parent Progress Queries
// ============================================

/**
 * Hook to fetch parent's children progress
 */
export function useParentProgress() {
  const client = useApiClient()

  return useQuery<ParentProgressViewRecord[]>({
    queryKey: ['progress', 'parent'],
    queryFn: async () => {
      const response = await client.get('/progress/parent')
      if (response.error) throw new Error(response.error)
      return response.data
    },
  })
}

/**
 * Hook to fetch parent dashboard aggregate stats and child cards
 */
export function useParentDashboardStats() {
  const client = useApiClient()

  return useQuery<{
    children: Array<{
      id: string
      name: string
      grade?: string
      overall_progress: number
      recent_grade?: string
      assignments_due: number
    }>
  }>({
    queryKey: ['parent-dashboard-stats'],
    queryFn: async () => {
      const response = await client.get('/dashboard/parent-stats')
      if (response.error) throw new Error(response.error)
      return response.data as {
        children: Array<{
          id: string
          name: string
          grade?: string
          overall_progress: number
          recent_grade?: string
          assignments_due: number
        }>
      }
    },
    staleTime: 60 * 1000,
  })
}

// ============================================
// Conversation & Message Queries
// ============================================

/**
 * Hook to fetch all conversations for the current user
 */
export function useConversations() {
  const client = useApiClient()

  return useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const response = await client.get('/conversations')
      if (response.error) throw new Error(response.error)
      const payload = response.data
      if (Array.isArray(payload)) return payload
      if (Array.isArray(payload?.items)) return payload.items
      if (Array.isArray(payload?.conversations)) return payload.conversations
      return []
    },
  })
}

/**
 * Hook to fetch messages for a specific conversation
 */
export function useMessages(conversationId: string | undefined, page: number = 1, pageSize: number = 50) {
  const client = useApiClient()

  return useQuery({
    queryKey: ['messages', conversationId, page],
    queryFn: async () => {
      if (!conversationId) throw new Error('Conversation ID is required')
      const response = await client.get(`/messages/conversation/${conversationId}?page=${page}&page_size=${pageSize}`)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!conversationId,
  })
}

// ============================================
// Announcements Queries
// ============================================

/**
 * Hook to fetch announcements/notifications
 */
export function useAnnouncements() {
  const client = useApiClient()

  return useQuery<NotificationItem[]>({
    queryKey: ['announcements'],
    queryFn: async () => {
      const response = await client.get('/notifications?per_page=10')
      if (response.error) throw new Error(response.error)
      return response.data?.items || response.data || []
    },
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    // refetchInterval removed — backend WebSocket events invalidate this query (C3)
  })
}

// ============================================
// Student Dashboard Queries
// ============================================

/**
 * Hook to fetch student dashboard stats
 */
export function useStudentDashboardStats() {
  const client = useApiClient()

  return useQuery<StudentDashboardStatsResponse>({
    queryKey: ['student-dashboard-stats'],
    queryFn: async () => {
      const response = await client.get('/dashboard/student-stats')
      if (response.error) throw new Error(response.error)
      return response.data as StudentDashboardStatsResponse
    },
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: true,
    refetchInterval: 120 * 1000,
  })
}

/**
 * Hook to fetch student progress analytics
 */
export function useStudentProgressAnalytics() {
  const client = useApiClient()

  return useQuery<StudentProgressAnalyticsResponse>({
    queryKey: ['student-progress-analytics'],
    queryFn: async () => {
      const response = await client.get('/progress/student')
      if (response.error) throw new Error(response.error)
      return response.data as StudentProgressAnalyticsResponse
    },
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: true,
    refetchInterval: 120 * 1000,
  })
}

/**
 * Hook to fetch student's personal activity feed
 */
export function useMyActivities(limit: number = 20) {
  const client = useApiClient()

  return useQuery<StudentActivityRecord[]>({
    queryKey: ['activities', 'me', limit],
    queryFn: async () => {
      const response = await client.get(`/activity/me?limit=${limit}`)
      if (response.error) throw new Error(response.error)
      return Array.isArray(response.data) ? response.data : []
    },
    staleTime: 20 * 1000,
    refetchOnWindowFocus: true,
    // refetchInterval removed — backend WebSocket events invalidate this query (C3)
  })
}

/**
 * Hook to fetch materials visible to the current student
 */
export function useStudentMaterials(subjectId?: string) {
  const client = useApiClient()

  return useQuery<StudentMaterialRecord[]>({
    queryKey: ['materials', 'student', subjectId || 'all'],
    queryFn: async () => {
      const suffix = subjectId ? `?subject_id=${encodeURIComponent(subjectId)}` : ''
      const response = await client.get(`/materials/student${suffix}`)
      if (response.error) throw new Error(response.error)
      return Array.isArray(response.data) ? response.data : []
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

export interface UserPreferenceSettings {
  default_student_tab: 'dashboard' | 'courses' | 'assignments' | 'grades' | 'library' | 'messages'
  default_parent_tab: 'overview' | 'children' | 'upcoming' | 'messages'
  show_weekend_schedule: boolean
  compact_assignment_cards: boolean
  auto_open_next_assignment: boolean
}

export interface UserSettingsResponse {
  profile?: {
    display_name?: string | null
    timezone?: string
  }
  notifications?: {
    email_notifications?: boolean
    assignment_reminders?: boolean
    message_notifications?: boolean
    weekly_digest?: boolean
  }
  privacy?: {
    profile_visibility?: string
    show_email?: boolean
    show_phone?: boolean
  }
  preferences?: Partial<UserPreferenceSettings>
}

/**
 * Hook to fetch current user's settings/preferences
 */
export function useUserSettings() {
  const client = useApiClient()

  return useQuery<UserSettingsResponse>({
    queryKey: ['user-settings'],
    queryFn: async () => {
      const response = await client.get('/settings/user')
      if (response.error) throw new Error(response.error)
      return (response.data || {}) as UserSettingsResponse
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

// ============================================
// Generation History Queries
// ============================================

/**
 * Hook to fetch question generation history
 */
export function useGenerationHistory() {
  const client = useApiClient()

  return useQuery({
    queryKey: ['generation-history'],
    queryFn: async () => {
      const response = await client.get('/questions/generation-history')
      if (response.error) throw new Error(response.error)
      return response.data?.items || response.data || []
    },
  })
}

/**
 * Hook to fetch question generation statistics
 */
export function useGenerationStats() {
  const client = useApiClient()

  return useQuery({
    queryKey: ['generation-stats'],
    queryFn: async () => {
      const response = await client.get('/question-generator/stats')
      if (response.error) throw new Error(response.error)
      return response.data as {
        total_generated: number
        this_month: number
        success_rate: number
        avg_quality: number
        total_sessions: number
        month_sessions: number
        approved_questions: number
        rejected_questions: number
      }
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  })
}

/**
 * Hook to fetch all generated questions for analytics
 */
export function useAllGeneratedQuestions() {
  const client = useApiClient()

  return useQuery<JsonRecord[]>({
    queryKey: ['all-generated-questions'],
    queryFn: async () => {
      const response = await client.get('/question-generator/all-questions?per_page=200')
      if (response.error) throw new Error(response.error)
      const data = response.data
      return (data?.items || (Array.isArray(data) ? data : [])) as JsonRecord[]
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  })
}

/**
 * Hook to fetch student assignments list
 */
export function useStudentAssignmentsList(studentId: string | undefined) {
  const client = useApiClient()

  return useQuery({
    queryKey: ['assignments', 'student', studentId],
    queryFn: async () => {
      if (!studentId) throw new Error('Student ID is required')
      const response = await client.get(`/assignments?student_id=${studentId}`)
      if (response.error) throw new Error(response.error)
      return response.data?.items || response.data || []
    },
    enabled: !!studentId,
  })
}

