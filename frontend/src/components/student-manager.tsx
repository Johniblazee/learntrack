import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  UserPlus,
  MoreVertical,
  MessageCircle,
  Edit,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Link,
  Search
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { toast } from "@/contexts/ToastContext"
import { SendMessageModal } from "@/components/modals/SendMessageModal"
import InviteUserModal from "@/components/InviteUserModal"
import { ConfirmDeleteModal } from "@/components/modals/ConfirmDeleteModal"
import { useStudents, useDeleteStudent } from "@/hooks/useQueries"
import { Pagination } from "@/components/Pagination"
import { StudentTableSkeleton } from "@/components/skeletons"
import { LinkParentModal } from '@/components/modals/LinkParentModal'

type SortField = 'lastActive' | 'progress' | null

interface Student {
  id: string
  slug: string
  name: string
  email: string
  avatar?: string
  updatedAt: string
  lastActive: string
  progress: number
  parentName?: string | null
}

export default function StudentManager() {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const [sendMessageModalOpen, setSendMessageModalOpen] = useState(false)
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [linkParentModalOpen, setLinkParentModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null)
  const [sortField, setSortField] = useState<SortField>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Fetch students using React Query with pagination
  const { data, isLoading, isError, error } = useStudents(currentPage, itemsPerPage)

  // Delete mutation
  const deleteStudentMutation = useDeleteStudent()

  // Helper function to format last active time
  const formatLastActive = (updatedAt: string) => {
    const lastActiveDate = updatedAt ? new Date(updatedAt) : new Date()
    const now = new Date()
    const diffMs = now.getTime() - lastActiveDate.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    const diffWeeks = Math.floor(diffDays / 7)

    if (diffHours < 1) return 'Just now'
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`
  }

  // Map API response to Student interface
  const students: Student[] = data?.items?.map((student: any) => ({
    id: student.clerk_id || student._id,
    slug: student.slug || student.name.toLowerCase().replace(/\s+/g, '-'),
    name: student.name,
    email: student.email,
    avatar: student.avatar_url || undefined,
    updatedAt: student.updated_at,
    lastActive: formatLastActive(student.updated_at),
    progress: student.student_profile?.averageScore ?? 0,
    parentName: student.parent_name || null
  })) || []

  // Show error toast
  useEffect(() => {
    if (isError) {
      toast.error('Failed to load students')
    }
  }, [isError])

  // Filter and sort students client-side
  const filteredStudents = useMemo(() => {
    const searchLower = searchTerm.toLowerCase()

    return students.filter((student) => (
      student.name.toLowerCase().includes(searchLower) ||
      student.email.toLowerCase().includes(searchLower)
    ))
  }, [students, searchTerm])

  const sortedStudents = useMemo(() => {
    if (!sortField) return filteredStudents

    const sorted = [...filteredStudents].sort((a, b) => {
      if (sortField === 'progress') {
        return a.progress - b.progress
      }

      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return timeA - timeB
    })

    return sortDirection === 'asc' ? sorted : sorted.reverse()
  }, [filteredStudents, sortField, sortDirection])

  // Reset to page 1 when search term changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  const handleSort = (field: Exclude<SortField, null>) => {
    if (sortField === field) {
      setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortField(field)
    setSortDirection('asc')
  }

  const getSortIcon = (field: Exclude<SortField, null>) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3 w-3" />
    }

    return sortDirection === 'asc'
      ? <ArrowUp className="h-3 w-3" />
      : <ArrowDown className="h-3 w-3" />
  }

  // Handle delete student
  const handleDeleteStudent = async () => {
    if (!selectedStudent) return

    try {
      await deleteStudentMutation.mutateAsync(selectedStudent.id)
      toast.success('Student deleted successfully')
      setDeleteModalOpen(false)
      setSelectedStudent(null)
    } catch (error) {
      console.error('Failed to delete student:', error)
      toast.error('Failed to delete student')
    }
  }

  const openDeleteModal = (student: Student) => {
    setSelectedStudent(student)
    setDeleteModalOpen(true)
  }

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm bg-card">
        <CardContent className="p-6">
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-foreground mb-4">All Students</h2>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search students by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button
                onClick={() => setInviteModalOpen(true)}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Invite Student
              </Button>
              <Button
                variant="outline"
                onClick={() => setLinkParentModalOpen(true)}
              >
                <Link className="h-4 w-4 mr-2" />
                Link Parent
              </Button>
            </div>
          </div>

              {/* Table */}
              {isLoading ? (
                // Show skeleton while loading
                <StudentTableSkeleton rows={itemsPerPage} />
              ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Student Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Parent</TableHead>
                      <TableHead>
                        <button
                          onClick={() => handleSort('lastActive')}
                          className="flex items-center gap-1 hover:text-foreground transition-colors uppercase"
                        >
                          Last Active
                          {getSortIcon('lastActive')}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          onClick={() => handleSort('progress')}
                          className="flex items-center gap-1 hover:text-foreground transition-colors uppercase"
                        >
                          Progress
                          {getSortIcon('progress')}
                        </button>
                      </TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isError ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12">
                          <div className="text-destructive">
                            <p className="font-semibold mb-2">Failed to load students</p>
                            <p className="text-sm text-muted-foreground">{error?.message || 'Unknown error'}</p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-4"
                              onClick={() => window.location.reload()}
                            >
                              Retry
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : sortedStudents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                          {searchTerm ? 'No students found matching your search' : 'No students found'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedStudents.map((student) => (
                        <TableRow
                          key={student.id}
                          className="hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => navigate(`/dashboard/students/${student.slug}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="w-10 h-10">
                                <AvatarImage src={student.avatar} alt={student.name} />
                                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                                  {student.name.split(' ').map(n => n[0]).join('')}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium text-foreground">{student.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {student.email}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {student.parentName || (
                              <span className="italic text-muted-foreground/60">No parent linked</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {student.lastActive}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Progress value={student.progress} className="h-2 flex-1" />
                              <span className="text-sm text-muted-foreground min-w-[3ch]">
                                {student.progress}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedStudent(student)
                                    setSendMessageModalOpen(true)
                                  }}
                                >
                                  <MessageCircle className="h-4 w-4 mr-2" />
                                  Send a message
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => navigate(`/dashboard/students/${student.slug}`)}>
                                  <Edit className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => openDeleteModal(student)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
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
              )}

              {/* Pagination */}
              {!isLoading && data?.meta && data.meta.total_pages > 1 && (
                <div className="mt-6 space-y-4">
                  <div className="text-sm text-muted-foreground text-center">
                    Showing {((data.meta.page - 1) * data.meta.per_page) + 1} to {Math.min(data.meta.page * data.meta.per_page, data.meta.total)} of {data.meta.total} students
                  </div>
                  <Pagination
                    currentPage={data.meta.page}
                    totalPages={data.meta.total_pages}
                    onPageChange={setCurrentPage}
                    hasNext={data.meta.has_next}
                    hasPrev={data.meta.has_prev}
                  />
                </div>
              )}
            </CardContent>
          </Card>

      {/* Send Message Modal */}
      <SendMessageModal
        open={sendMessageModalOpen}
        onOpenChange={setSendMessageModalOpen}
        student={selectedStudent}
        onMessageSent={() => {
          toast.success('Message sent successfully')
        }}
      />

      {/* Invite Student Modal */}
      <InviteUserModal
        open={inviteModalOpen}
        onOpenChange={setInviteModalOpen}
        role="student"
      />

      <LinkParentModal
        open={linkParentModalOpen}
        onOpenChange={setLinkParentModalOpen}
        students={students.map((student) => ({
          _id: student.id,
          name: student.name,
        }))}
        onParentLinked={() => {
          queryClient.invalidateQueries({ queryKey: ['students'] })
        }}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmDeleteModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        onConfirm={handleDeleteStudent}
        title="Delete Student?"
        description="Are you sure you want to delete this student? This action cannot be undone."
        itemName={selectedStudent?.name}
        loading={deleteStudentMutation.isPending}
      />
    </div>
  )
}
