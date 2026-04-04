import { useState, useEffect, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterToolbar } from "@/components/ui/filter-toolbar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Edit, Trash2, Eye, Search, Plus, MoreVertical, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { useApiClient } from "@/lib/api-client"
import { toast } from "@/contexts/ToastContext"
import { ServerError } from '@/components/ErrorScreen'
import { useNavigate } from 'react-router-dom'
import { ViewAssignmentModal } from '@/components/modals/ViewAssignmentModal'
import { EditAssignmentModal } from '@/components/modals/EditAssignmentModal'
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal'
import { useSubjects } from '@/hooks/useQueries'

interface Assignment {
  id: string
  title: string
  subject: string
  topic: string
  dueDate: string
  status: string
  studentCount: number
  completedCount: number
  questionCount: number
  averageScore?: number
}

interface RawAssignment {
  _id?: string
  id?: string
  title?: string
  description?: string
  subject_id?: string | { _id?: string; id?: string; name?: string }
  topic?: string | null
  due_date?: string | null
  status?: string
  student_ids?: string[]
  assigned_students?: string[]
  group_ids?: string[]
  completion_count?: number
  questions?: Array<{ question_id?: string }>
  average_score?: number | null
  time_limit?: number | null
  max_attempts?: number | null
  shuffle_questions?: boolean
  show_results_immediately?: boolean
  total_points?: number
  created_at?: string
  updated_at?: string
}

type AssignmentStatusValue = 'draft' | 'scheduled' | 'published' | 'active' | 'completed' | 'archived'

interface ModalAssignment extends Omit<RawAssignment, 'status' | 'total_points' | 'questions'> {
  _id: string
  title: string
  total_points: number
  status: AssignmentStatusValue
  questions?: Array<{ question_id: string }>
}

interface BulkAssignmentStatusResponse {
  requested_count?: number
  updated_count?: number
  updated_assignment_ids?: string[]
  skipped_count?: number
  skipped_assignment_ids?: string[]
}

interface BulkAssignmentDeleteResponse {
  requested_count?: number
  deleted_count?: number
  deleted_assignment_ids?: string[]
  skipped_count?: number
  skipped_assignment_ids?: string[]
}

interface SubjectOption {
  id: string
  name: string
}

const normalizeAssignmentStatus = (status?: string): AssignmentStatusValue => {
  switch (status) {
    case 'draft':
    case 'scheduled':
    case 'published':
    case 'active':
    case 'completed':
    case 'archived':
      return status
    default:
      return 'draft'
  }
}

export default function ActiveAssignmentsView() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [subjectFilter, setSubjectFilter] = useState("all")
  const [rawAssignments, setRawAssignments] = useState<RawAssignment[]>([])
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Sorting state
  const [sortColumn, setSortColumn] = useState<'dueDate' | 'status' | 'submissions' | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  // Modal state
  const [viewModalOpen, setViewModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [selectedAssignment, setSelectedAssignment] = useState<ModalAssignment | null>(null)
  const [assignmentToDelete, setAssignmentToDelete] = useState<Assignment | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkUpdatingStatus, setBulkUpdatingStatus] = useState(false)

  const client = useApiClient()
  const { data: subjectsResponse } = useSubjects()

  const subjects: SubjectOption[] = useMemo(() => {
    const source = Array.isArray(subjectsResponse)
      ? subjectsResponse
      : (subjectsResponse as any)?.items || []

    return source
      .map((subject: any) => ({
        id: String(subject.id || subject._id || ''),
        name: subject.name || 'Unknown',
      }))
      .filter((subject: SubjectOption) => subject.id)
  }, [subjectsResponse])

  const subjectNameById = useMemo(() => {
    return new Map(subjects.map((subject) => [subject.id, subject.name]))
  }, [subjects])

  const assignments: Assignment[] = useMemo(() => {
    const resolveSubjectName = (subjectValue: RawAssignment['subject_id']): string => {
      if (subjectValue && typeof subjectValue === 'object') {
        if (subjectValue.name) return subjectValue.name
        const subjectId = String(subjectValue.id || subjectValue._id || '')
        if (subjectId) return subjectNameById.get(subjectId) || 'Unknown'
      }

      const subjectId = String(subjectValue || '')
      if (!subjectId) return 'Unknown'
      return subjectNameById.get(subjectId) || 'Unknown'
    }

    return rawAssignments.map((assignment) => {
      const studentIds = Array.isArray(assignment.student_ids)
        ? assignment.student_ids
        : Array.isArray(assignment.assigned_students)
        ? assignment.assigned_students
        : []

      const completionCount = Number(assignment.completion_count || 0)

      return {
        id: String(assignment._id || assignment.id || ''),
        title: assignment.title || 'Untitled Assignment',
        subject: resolveSubjectName(assignment.subject_id),
        topic: assignment.topic || 'General',
        dueDate: assignment.due_date
          ? new Date(assignment.due_date).toISOString().split('T')[0]
          : 'N/A',
        status: String(assignment.status || 'draft'),
        studentCount: studentIds.length,
        completedCount: completionCount,
        questionCount: assignment.questions?.length || 0,
        averageScore:
          typeof assignment.average_score === 'number'
            ? assignment.average_score
            : undefined,
      }
    })
  }, [rawAssignments, subjectNameById])

  const availableSubjects = useMemo(() => {
    return Array.from(new Set(assignments.map((assignment) => assignment.subject))).sort(
      (a, b) => a.localeCompare(b)
    )
  }, [assignments])

  const availableStatuses = useMemo(() => {
    return Array.from(new Set(assignments.map((assignment) => assignment.status))).sort(
      (a, b) => a.localeCompare(b)
    )
  }, [assignments])

    const fetchAssignments = async () => {
    try {
      setLoading(true)
      setError(null)
      const collectedAssignments: RawAssignment[] = []
      let page = 1
      let hasNext = true

      while (hasNext) {
        const response = await client.get(`/assignments/?page=${page}&per_page=100`)

        if (response.error) {
          throw new Error(response.error)
        }

        const data = response.data
        const pageItems = (data?.items as RawAssignment[]) || (Array.isArray(data) ? data as RawAssignment[] : [])
        collectedAssignments.push(...pageItems)
        hasNext = Boolean(data?.meta?.has_next)
        page += 1
      }

      setRawAssignments(collectedAssignments)
    } catch (err: any) {
      console.error('Failed to fetch assignments:', err)
      setError(err)
      toast.error('Failed to load assignments', {
        description: err.message || 'Please try again later'
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAssignments()
  }, [])

  useEffect(() => {
    const availableIds = new Set(assignments.map((assignment) => assignment.id))
    setSelectedAssignmentIds((previous) => {
      return new Set([...previous].filter((assignmentId) => availableIds.has(assignmentId)))
    })
  }, [assignments])

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return 'Active'
      case 'published':
        return 'Published'
      case 'scheduled':
        return 'Scheduled'
      case 'completed':
        return 'Completed'
      case 'draft':
        return 'Draft'
      case 'archived':
        return 'Archived'
      default:
        return status
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
      case 'scheduled':
      case 'published':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-0'
      case 'completed':
        return 'bg-green-500/10 text-green-600 dark:text-green-400 border-0'
      case 'draft':
        return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-0'
      case 'archived':
        return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-0'
      default:
        return 'bg-muted text-muted-foreground border-0'
    }
  }

  const formatDate = (dateString: string) => {
    if (dateString === "N/A") return "N/A"
    const date = new Date(dateString)
    const month = date.toLocaleDateString('en-US', { month: 'short' })
    const day = date.getDate()
    const year = date.getFullYear()
    return `${month} ${day}, ${year}`
  }

  const handleSort = (column: 'dueDate' | 'status' | 'submissions') => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // Set new column and default to ascending
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const getSortIcon = (column: 'dueDate' | 'status' | 'submissions') => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-3 w-3 ml-1" />
    }
    return sortDirection === 'asc' ?
      <ArrowUp className="h-3 w-3 ml-1" /> :
      <ArrowDown className="h-3 w-3 ml-1" />
  }

  const filteredAssignments = assignments.filter(assignment => {
    const matchesSearch = assignment.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         assignment.subject.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "all" || assignment.status === statusFilter
    const matchesSubject = subjectFilter === "all" || assignment.subject === subjectFilter
    return matchesSearch && matchesStatus && matchesSubject
  })

  // Sort assignments
  const sortedAssignments = [...filteredAssignments].sort((a, b) => {
    if (!sortColumn) return 0

    let comparison = 0

    if (sortColumn === 'dueDate') {
      const dateA = a.dueDate === "N/A" ? new Date(0) : new Date(a.dueDate)
      const dateB = b.dueDate === "N/A" ? new Date(0) : new Date(b.dueDate)
      comparison = dateA.getTime() - dateB.getTime()
    } else if (sortColumn === 'status') {
      comparison = a.status.localeCompare(b.status)
    } else if (sortColumn === 'submissions') {
      const percentA = a.studentCount > 0 ? (a.completedCount / a.studentCount) : 0
      const percentB = b.studentCount > 0 ? (b.completedCount / b.studentCount) : 0
      comparison = percentA - percentB
    }

    return sortDirection === 'asc' ? comparison : -comparison
  })

  // Pagination
  const totalPages = Math.ceil(sortedAssignments.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentAssignments = sortedAssignments.slice(startIndex, endIndex)
  const allVisibleAssignmentsSelected =
    currentAssignments.length > 0 && currentAssignments.every((assignment) => selectedAssignmentIds.has(assignment.id))
  const someVisibleAssignmentsSelected =
    currentAssignments.some((assignment) => selectedAssignmentIds.has(assignment.id)) && !allVisibleAssignmentsSelected

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, statusFilter, subjectFilter])

  const handleToggleSelectAssignment = (assignmentId: string) => {
    setSelectedAssignmentIds((previous) => {
      const next = new Set(previous)
      if (next.has(assignmentId)) {
        next.delete(assignmentId)
      } else {
        next.add(assignmentId)
      }
      return next
    })
  }

  const handleSelectAllVisibleAssignments = () => {
    const visibleIds = currentAssignments.map((assignment) => assignment.id)
    setSelectedAssignmentIds((previous) => {
      const next = new Set(previous)
      if (visibleIds.every((assignmentId) => next.has(assignmentId))) {
        visibleIds.forEach((assignmentId) => next.delete(assignmentId))
      } else {
        visibleIds.forEach((assignmentId) => next.add(assignmentId))
      }
      return next
    })
  }

  const handleDeselectAllAssignments = () => {
    setSelectedAssignmentIds(new Set())
  }

  const confirmDelete = async () => {
    if (!assignmentToDelete) {
      return
    }

    try {
      const response = await client.delete(`/assignments/${assignmentToDelete.id}`)

      if (response.error) {
        throw new Error(response.error)
      }

      // Remove from local state
      setRawAssignments((previous) =>
        previous.filter((assignment) => String(assignment._id || assignment.id || '') !== assignmentToDelete.id)
      )
      setSelectedAssignmentIds((previous) => {
        const next = new Set(previous)
        next.delete(assignmentToDelete.id)
        return next
      })
      setDeleteModalOpen(false)
      setAssignmentToDelete(null)

      toast.success('Assignment deleted', {
        description: `"${assignmentToDelete.title}" has been deleted successfully`
      })
    } catch (err: any) {
      console.error('Failed to delete assignment:', err)
      toast.error('Failed to delete assignment', {
        description: err.message || 'Please try again later'
      })
    }
  }

  const handleRequestDelete = (assignment: Assignment) => {
    setAssignmentToDelete(assignment)
    setDeleteModalOpen(true)
  }

  const handleBulkStatusUpdate = async (status: 'archived') => {
    if (selectedAssignmentIds.size === 0) {
      return
    }

    try {
      setBulkUpdatingStatus(true)
      const response = await client.post<BulkAssignmentStatusResponse>('/assignments/bulk-status', {
        assignment_ids: [...selectedAssignmentIds],
        status,
      })

      if (response.error) {
        throw new Error(response.error)
      }

      const updatedIds = new Set((response.data?.updated_assignment_ids || []).map(String))
      setRawAssignments((previous) =>
        previous.map((assignment) => {
          const assignmentId = String(assignment._id || assignment.id || '')
          if (!updatedIds.has(assignmentId)) {
            return assignment
          }

          return {
            ...assignment,
            status,
          }
        })
      )
      setSelectedAssignmentIds(new Set())

      toast.success('Assignments updated', {
        description: `${response.data?.updated_count || 0} updated${response.data?.skipped_count ? `, ${response.data.skipped_count} skipped` : ''}`,
      })
    } catch (err: any) {
      console.error('Failed to bulk update assignments:', err)
      toast.error('Failed to update selected assignments', {
        description: err.message || 'Please try again later'
      })
    } finally {
      setBulkUpdatingStatus(false)
    }
  }

  const handlePublishAssignment = async (assignmentId: string) => {
    const targetAssignment = assignments.find((assignment) => assignment.id === assignmentId)

    try {
      const response = await client.post(`/assignments/${assignmentId}/publish`, {})

      if (response.error) {
        throw new Error(response.error)
      }

      const updatedAssignment = response.data as RawAssignment | undefined
      setRawAssignments((previous) =>
        previous.map((assignment) => {
          const rawAssignmentId = String(assignment._id || assignment.id || '')
          if (rawAssignmentId !== assignmentId) {
            return assignment
          }

          return {
            ...assignment,
            ...(updatedAssignment || {}),
          }
        })
      )

      toast.success('Assignment published', {
        description: targetAssignment
          ? `"${targetAssignment.title}" is now visible to students.`
          : 'The assignment is now visible to students.',
      })
    } catch (err: any) {
      console.error('Failed to publish assignment:', err)
      toast.error('Failed to publish assignment', {
        description: err.message || 'Please try again later',
      })
    }
  }

  const handleBulkPublishSelected = async () => {
    const draftAssignments = assignments.filter(
      (assignment) => selectedAssignmentIds.has(assignment.id) && assignment.status === 'draft'
    )

    if (draftAssignments.length === 0) {
      toast.error('Select at least one draft assignment to publish')
      return
    }

    try {
      setBulkUpdatingStatus(true)
      const results = await Promise.allSettled(
        draftAssignments.map((assignment) =>
          client.post(`/assignments/${assignment.id}/publish`, {})
        )
      )

      const successCount = results.filter(
        (result) => result.status === 'fulfilled' && !result.value.error
      ).length
      const failedCount = results.length - successCount

      if (successCount > 0) {
        await fetchAssignments()
        setSelectedAssignmentIds(new Set())
        toast.success('Draft assignments published', {
          description:
            failedCount > 0
              ? `${successCount} published, ${failedCount} failed.`
              : `${successCount} assignment${successCount === 1 ? '' : 's'} published.`,
        })
        return
      }

      toast.error('Failed to publish selected draft assignments')
    } catch (err: any) {
      console.error('Failed to bulk publish assignments:', err)
      toast.error('Failed to publish selected draft assignments', {
        description: err.message || 'Please try again later',
      })
    } finally {
      setBulkUpdatingStatus(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedAssignmentIds.size === 0) {
      return
    }

    try {
      setBulkDeleting(true)
      const response = await client.post<BulkAssignmentDeleteResponse>('/assignments/bulk-delete', {
        assignment_ids: [...selectedAssignmentIds],
      })

      if (response.error) {
        throw new Error(response.error)
      }

      const deletedIds = new Set((response.data?.deleted_assignment_ids || []).map(String))
      setRawAssignments((previous) =>
        previous.filter((assignment) => !deletedIds.has(String(assignment._id || assignment.id || '')))
      )
      setSelectedAssignmentIds(new Set())
      setBulkDeleteModalOpen(false)

      toast.success('Assignments deleted', {
        description: `${response.data?.deleted_count || 0} deleted${response.data?.skipped_count ? `, ${response.data.skipped_count} skipped` : ''}`,
      })
    } catch (err: any) {
      console.error('Failed to bulk delete assignments:', err)
      toast.error('Failed to delete selected assignments', {
        description: err.message || 'Please try again later'
      })
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleView = (assignmentId: string) => {
    const rawAssignment = rawAssignments.find(
      (assignment) => String(assignment._id || assignment.id || '') === assignmentId
    )
    if (rawAssignment) {
      setSelectedAssignment({
        ...rawAssignment,
        _id: String(rawAssignment._id || rawAssignment.id || assignmentId),
        title: rawAssignment.title || 'Untitled Assignment',
        total_points: rawAssignment.total_points || 0,
        status: normalizeAssignmentStatus(rawAssignment.status),
        questions: Array.isArray(rawAssignment.questions)
          ? rawAssignment.questions
              .map((question) => ({ question_id: String(question.question_id || '') }))
              .filter((question) => question.question_id)
          : [],
      })
      setViewModalOpen(true)
    }
  }

  const handleEdit = (assignmentId: string) => {
    const rawAssignment = rawAssignments.find(
      (assignment) => String(assignment._id || assignment.id || '') === assignmentId
    )
    if (rawAssignment) {
      setSelectedAssignment({
        ...rawAssignment,
        _id: String(rawAssignment._id || rawAssignment.id || assignmentId),
        title: rawAssignment.title || 'Untitled Assignment',
        total_points: rawAssignment.total_points || 0,
        status: normalizeAssignmentStatus(rawAssignment.status),
        questions: Array.isArray(rawAssignment.questions)
          ? rawAssignment.questions
              .map((question) => ({ question_id: String(question.question_id || '') }))
              .filter((question) => question.question_id)
          : [],
      })
      setEditModalOpen(true)
    }
  }

  const handleCreateNew = () => {
    navigate('/dashboard/assignments/create')
  }

  // Show error screen if there's an error
  if (error) {
    return <ServerError error={error} onRetry={fetchAssignments} />
  }

  return (
    <div className="h-full overflow-hidden">
      {/* Main Content */}
      <div className="h-full overflow-y-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Active Assignments</h1>
            <p className="text-muted-foreground mt-1">
              Manage and track your assignments
            </p>
          </div>
          <Button
            onClick={handleCreateNew}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Assignment
          </Button>
        </div>

        {/* Filters Container */}
        <div className="bg-muted/30 border border-border rounded-lg p-4">
          <FilterToolbar>
            <div className="relative w-[300px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search assignments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-background border-border h-10"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px] h-10 border-border bg-background">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {availableStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {getStatusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="w-[180px] h-10 border-border bg-background">
                <SelectValue placeholder="All Subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                {availableSubjects.map((subject) => (
                  <SelectItem key={subject} value={subject}>
                    {subject}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterToolbar>
        </div>

        {/* Table */}
        <div className="border border-border rounded-lg overflow-hidden bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-12">
                    <Checkbox
                      checked={allVisibleAssignmentsSelected ? true : someVisibleAssignmentsSelected ? 'indeterminate' : false}
                      onCheckedChange={handleSelectAllVisibleAssignments}
                      aria-label="Select all visible assignments"
                    />
                  </TableHead>
                  <TableHead>Assignment Title</TableHead>
                  <TableHead>Class/Group</TableHead>
                <TableHead>
                  <button
                    onClick={() => handleSort('submissions')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors uppercase"
                  >
                    Submissions
                    {getSortIcon('submissions')}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    onClick={() => handleSort('dueDate')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors uppercase"
                  >
                    Due Date
                    {getSortIcon('dueDate')}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    onClick={() => handleSort('status')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors uppercase"
                  >
                    Status
                    {getSortIcon('status')}
                  </button>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                // Loading skeleton
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <div className="h-4 bg-muted rounded w-4 animate-pulse"></div>
                    </TableCell>
                    <TableCell>
                      <div className="h-4 bg-muted rounded w-48 animate-pulse"></div>
                    </TableCell>
                    <TableCell>
                      <div className="h-4 bg-muted rounded w-32 animate-pulse"></div>
                    </TableCell>
                    <TableCell>
                      <div className="h-4 bg-muted rounded w-24 animate-pulse"></div>
                    </TableCell>
                    <TableCell>
                      <div className="h-4 bg-muted rounded w-32 animate-pulse"></div>
                    </TableCell>
                    <TableCell>
                      <div className="h-6 bg-muted rounded w-24 animate-pulse"></div>
                    </TableCell>
                    <TableCell>
                      <div className="h-8 bg-muted rounded w-8 animate-pulse ml-auto"></div>
                    </TableCell>
                  </TableRow>
                ))
              ) : currentAssignments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    {searchTerm || statusFilter !== "all" || subjectFilter !== "all"
                      ? "No assignments found. Try adjusting your filters."
                      : "No assignments yet. Create your first assignment to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                currentAssignments.map((assignment) => (
                  <TableRow
                    key={assignment.id}
                    className={selectedAssignmentIds.has(assignment.id) ? 'bg-primary/5 hover:bg-primary/10 transition-colors' : 'hover:bg-muted/30 transition-colors'}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedAssignmentIds.has(assignment.id)}
                        onCheckedChange={() => handleToggleSelectAssignment(assignment.id)}
                        aria-label={`Select ${assignment.title}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {assignment.title}
                    </TableCell>
                    <TableCell className="text-foreground">
                      {assignment.subject}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-full max-w-[120px]">
                          <Progress
                            value={(assignment.completedCount / assignment.studentCount) * 100 || 0}
                            className="h-2"
                          />
                        </div>
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          {assignment.completedCount}/{assignment.studentCount}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground">
                      <div className="flex flex-col">
                        <span className="text-sm">{formatDate(assignment.dueDate)}</span>
                        <span className="text-xs text-muted-foreground">
                          {assignment.dueDate !== "N/A" && (() => {
                            const daysRemaining = Math.ceil(
                              (new Date(assignment.dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
                            )
                            if (daysRemaining < 0) return `${Math.abs(daysRemaining)} days overdue`
                            if (daysRemaining === 0) return 'Due today'
                            if (daysRemaining === 1) return 'Due tomorrow'
                            return `${daysRemaining} days remaining`
                          })()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(assignment.status)}>
                        {getStatusLabel(assignment.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {assignment.status === 'draft' && (
                            <DropdownMenuItem onClick={() => handlePublishAssignment(assignment.id)}>
                              <Plus className="w-4 h-4 mr-2" />
                              Publish
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleView(assignment.id)}>
                            <Eye className="w-4 h-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(assignment.id)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleRequestDelete(assignment)}
                            className="text-red-600 dark:text-red-500"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {!loading && sortedAssignments.length > 0 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(endIndex, sortedAssignments.length)} of {sortedAssignments.length} assignments
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="h-9"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                  // Show first page, last page, current page, and pages around current
                  if (
                    page === 1 ||
                    page === totalPages ||
                    (page >= currentPage - 1 && page <= currentPage + 1)
                  ) {
                    return (
                      <Button
                        key={page}
                        variant={currentPage === page ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(page)}
                        className={`h-9 w-9 ${currentPage === page ? 'bg-primary text-primary-foreground' : ''}`}
                      >
                        {page}
                      </Button>
                    )
                  } else if (
                    page === currentPage - 2 ||
                    page === currentPage + 2
                  ) {
                    return <span key={page} className="px-1">...</span>
                  }
                  return null
                })}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="h-9"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {selectedAssignmentIds.size > 0 && (
          <div className="sticky bottom-0 z-40 pt-2">
            <div className="bg-card border border-border rounded-lg shadow-lg p-4 flex items-center justify-between gap-4">
              <Badge variant="secondary">
                {selectedAssignmentIds.size} assignment{selectedAssignmentIds.size === 1 ? '' : 's'} selected
              </Badge>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleDeselectAllAssignments}>
                  Deselect All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkPublishSelected}
                  disabled={bulkUpdatingStatus}
                >
                  Publish Drafts
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkStatusUpdate('archived')}
                  disabled={bulkUpdatingStatus}
                >
                  Archive
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setBulkDeleteModalOpen(true)}>
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <ViewAssignmentModal
        open={viewModalOpen}
        onOpenChange={setViewModalOpen}
        assignment={selectedAssignment}
      />

      <EditAssignmentModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        assignment={selectedAssignment}
        onAssignmentUpdated={fetchAssignments}
      />

      <ConfirmDeleteModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        onConfirm={confirmDelete}
        title="Delete assignment?"
        description="This assignment will be removed from your active list. This action cannot be undone."
        itemName={assignmentToDelete?.title}
      />

      <ConfirmDeleteModal
        open={bulkDeleteModalOpen}
        onOpenChange={setBulkDeleteModalOpen}
        onConfirm={handleBulkDelete}
        title="Delete selected assignments?"
        description={`This will permanently delete ${selectedAssignmentIds.size} selected assignment${selectedAssignmentIds.size === 1 ? '' : 's'}. This action cannot be undone.`}
        loading={bulkDeleting}
      />
    </div>
  )
}
