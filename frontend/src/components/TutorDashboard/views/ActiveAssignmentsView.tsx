import { useState, useEffect, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

interface SubjectOption {
  id: string
  name: string
}

export default function ActiveAssignmentsView() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [subjectFilter, setSubjectFilter] = useState("all")
  const [rawAssignments, setRawAssignments] = useState<any[]>([]) // Store raw backend data for modals
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
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null)

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
    const resolveSubjectName = (subjectValue: any): string => {
      if (subjectValue && typeof subjectValue === 'object') {
        if (subjectValue.name) return subjectValue.name
        const subjectId = String(subjectValue.id || subjectValue._id || '')
        if (subjectId) return subjectNameById.get(subjectId) || 'Unknown'
      }

      const subjectId = String(subjectValue || '')
      if (!subjectId) return 'Unknown'
      return subjectNameById.get(subjectId) || 'Unknown'
    }

    return rawAssignments.map((assignment: any) => {
      const studentIds = Array.isArray(assignment.student_ids)
        ? assignment.student_ids
        : Array.isArray(assignment.assigned_students)
        ? assignment.assigned_students
        : []

      const completionCount = Number(assignment.completion_count || 0)

      return {
        id: String(assignment._id || assignment.id || ''),
        title: assignment.title,
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
      const response = await client.get('/assignments/')
      
      if (response.error) {
        throw new Error(response.error)
      }
      
      // Store raw backend data - API returns paginated response with items array
      const rawData = (response.data?.items as any[]) || (Array.isArray(response.data) ? response.data : [])
      setRawAssignments(rawData)

      if (rawData.length > 0) {
        toast.success(`Loaded ${rawData.length} assignment${rawData.length > 1 ? 's' : ''}`)
      }
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

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
      case 'published':
      case 'scheduled':
        return 'In Progress'
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
        return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-0'
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

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, statusFilter, subjectFilter])

  const handleDelete = async (assignmentId: string, title: string) => {
    try {
      const response = await client.delete(`/assignments/${assignmentId}`)

      if (response.error) {
        throw new Error(response.error)
      }

      // Remove from local state
      setRawAssignments((previous) =>
        previous.filter((assignment) => String(assignment._id || assignment.id || '') !== assignmentId)
      )

      toast.success('Assignment deleted', {
        description: `"${title}" has been deleted successfully`
      })
    } catch (err: any) {
      console.error('Failed to delete assignment:', err)
      toast.error('Failed to delete assignment', {
        description: err.message || 'Please try again later'
      })
    }
  }

  const handleView = (assignmentId: string) => {
    const rawAssignment = rawAssignments.find(
      (assignment) => String(assignment._id || assignment.id || '') === assignmentId
    )
    if (rawAssignment) {
      setSelectedAssignment(rawAssignment)
      setViewModalOpen(true)
    }
  }

  const handleEdit = (assignmentId: string) => {
    const rawAssignment = rawAssignments.find(
      (assignment) => String(assignment._id || assignment.id || '') === assignmentId
    )
    if (rawAssignment) {
      setSelectedAssignment(rawAssignment)
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
          <div className="flex items-center gap-3">
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
          </div>
        </div>

        {/* Table */}
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
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
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    {searchTerm || statusFilter !== "all" || subjectFilter !== "all"
                      ? "No assignments found. Try adjusting your filters."
                      : "No assignments yet. Create your first assignment to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                currentAssignments.map((assignment) => (
                  <TableRow key={assignment.id} className="hover:bg-muted/30 transition-colors">
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
                          <DropdownMenuItem onClick={() => handleView(assignment.id)}>
                            <Eye className="w-4 h-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(assignment.id)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(assignment.id, assignment.title)}
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
    </div>
  )
}

