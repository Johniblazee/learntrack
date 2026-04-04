import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from '@/components/ui/badge'
import { Checkbox } from "@/components/ui/checkbox"
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
import { CreateStudentModal } from '@/components/modals/CreateStudentModal'
import { ConfirmDeleteModal } from "@/components/modals/ConfirmDeleteModal"
import { useStudents, useDeleteStudent } from "@/hooks/useQueries"
import { Pagination } from "@/components/Pagination"
import { StudentTableSkeleton } from "@/components/skeletons"
import { LinkParentModal } from '@/components/modals/LinkParentModal'
import { useApiClient } from '@/lib/api-client'

type SortField = 'lastActive' | 'progress' | null

interface Student {
  id: string
  dbId: string
  clerkId?: string
  slug: string
  name: string
  email: string
  avatar?: string
  updatedAt: string
  lastActive: string
  progress: number
  parentName?: string | null
  accountStatus: 'provisioned' | 'invited' | 'claimed'
  lastInvitedAt?: string | null
}

const getAccountStatusBadge = (status: Student['accountStatus']) => {
  switch (status) {
    case 'claimed':
      return { label: 'Claimed', className: 'bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400' }
    case 'invited':
      return { label: 'Invited', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400' }
    default:
      return { label: 'Provisioned', className: 'bg-muted text-muted-foreground' }
  }
}

export default function StudentManager() {
  const client = useApiClient()
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const [sendMessageModalOpen, setSendMessageModalOpen] = useState(false)
  const [createStudentModalOpen, setCreateStudentModalOpen] = useState(false)
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [linkParentModalOpen, setLinkParentModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null)
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set())
  const [sortField, setSortField] = useState<SortField>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [invitingStudentId, setInvitingStudentId] = useState<string | null>(null)

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
    id: student._id,
    dbId: student._id,
    clerkId: student.clerk_id || undefined,
    slug: student.slug || student.name.toLowerCase().replace(/\s+/g, '-'),
    name: student.name,
    email: student.email,
    avatar: student.avatar_url || undefined,
    updatedAt: student.updated_at,
    lastActive:
      student.account_status === 'claimed'
        ? formatLastActive(student.updated_at)
        : student.account_status === 'invited'
          ? 'Awaiting claim'
          : 'Not signed in yet',
    progress: student.student_profile?.averageScore ?? 0,
    parentName: student.parent_name || null,
    accountStatus: student.account_status || (student.clerk_id ? 'claimed' : 'provisioned'),
    lastInvitedAt: student.last_invited_at || null,
  })) || []

  const claimedStudents = students.filter((student) => student.accountStatus === 'claimed' && student.clerkId)

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

  const allVisibleStudentsSelected =
    sortedStudents.length > 0 && sortedStudents.every((student) => selectedStudentIds.has(student.id))
  const someVisibleStudentsSelected =
    sortedStudents.some((student) => selectedStudentIds.has(student.id)) && !allVisibleStudentsSelected

  // Reset to page 1 when search term changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  useEffect(() => {
    const availableIds = new Set(students.map((student) => student.id))
    setSelectedStudentIds((previous) => new Set([...previous].filter((studentId) => availableIds.has(studentId))))
  }, [students])

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

  const handleToggleSelectStudent = (studentId: string) => {
    setSelectedStudentIds((previous) => {
      const next = new Set(previous)
      if (next.has(studentId)) {
        next.delete(studentId)
      } else {
        next.add(studentId)
      }
      return next
    })
  }

  const handleSelectAllVisibleStudents = () => {
    const visibleIds = sortedStudents.map((student) => student.id)
    setSelectedStudentIds((previous) => {
      const next = new Set(previous)
      if (visibleIds.every((studentId) => next.has(studentId))) {
        visibleIds.forEach((studentId) => next.delete(studentId))
      } else {
        visibleIds.forEach((studentId) => next.add(studentId))
      }
      return next
    })
  }

  const handleClearSelection = () => {
    setSelectedStudentIds(new Set())
  }

  const handleBulkDeleteStudents = async () => {
    if (selectedStudentIds.size === 0) return

    try {
      setBulkDeleting(true)
      const response = await client.post<{
        deleted_count?: number
        deleted_student_ids?: string[]
        skipped_count?: number
      }>('/students/bulk-delete', {
        student_ids: [...selectedStudentIds],
      })

      if (response.error) {
        throw new Error(response.error)
      }

      queryClient.invalidateQueries({ queryKey: ['students'] })
      setSelectedStudentIds(new Set())
      setBulkDeleteModalOpen(false)

      toast.success('Students deleted successfully', {
        description: `${response.data?.deleted_count || 0} deleted${response.data?.skipped_count ? `, ${response.data.skipped_count} skipped` : ''}`,
      })
    } catch (error: any) {
      console.error('Failed to delete selected students:', error)
      toast.error('Failed to delete selected students', {
        description: error.message || 'Please try again later',
      })
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleInviteToClaim = async (student: Student) => {
    try {
      setInvitingStudentId(student.dbId)
      const response = await client.post('/invitations/', {
        invitee_email: student.email,
        invitee_name: student.name,
        role: 'student',
      })

      if (response.error) {
        throw new Error(response.error)
      }

      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
      toast.success('Invitation sent', {
        description: `${student.name} can now claim their account from the invitation email.`,
      })
    } catch (error) {
      console.error('Failed to invite student:', error)
      toast.error('Failed to send invitation', {
        description: error instanceof Error ? error.message : 'Please try again later',
      })
    } finally {
      setInvitingStudentId(null)
    }
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
                    variant="outline"
                    onClick={() => setCreateStudentModalOpen(true)}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Create Student
                  </Button>
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
                    disabled={claimedStudents.length === 0}
                  >
                <Link className="h-4 w-4 mr-2" />
                    Link Parent
                  </Button>
                  {sortedStudents.length > 0 && (
                    <div className="flex items-center gap-2 pl-2">
                      <Checkbox
                        checked={allVisibleStudentsSelected ? true : someVisibleStudentsSelected ? 'indeterminate' : false}
                        onCheckedChange={handleSelectAllVisibleStudents}
                        aria-label="Select visible students"
                      />
                      <span className="text-sm text-muted-foreground">Select visible</span>
                    </div>
                  )}
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
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Student Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
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
                        <TableCell colSpan={8} className="text-center py-12">
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
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
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
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedStudentIds.has(student.id)}
                              onCheckedChange={() => handleToggleSelectStudent(student.id)}
                              aria-label={`Select ${student.name}`}
                            />
                          </TableCell>
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
                          <TableCell>
                            <Badge className={getAccountStatusBadge(student.accountStatus).className}>
                              {getAccountStatusBadge(student.accountStatus).label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {student.accountStatus !== 'claimed' ? (
                              <span className="italic text-muted-foreground/60">Available after claim</span>
                            ) : student.parentName || (
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
                                  disabled={!student.clerkId}
                                  onClick={() => {
                                    setSelectedStudent(student)
                                    setSendMessageModalOpen(true)
                                  }}
                                >
                                  <MessageCircle className="h-4 w-4 mr-2" />
                                  Send a message
                                </DropdownMenuItem>
                                {!student.clerkId && (
                                  <DropdownMenuItem
                                    disabled={invitingStudentId === student.dbId}
                                    onClick={() => void handleInviteToClaim(student)}
                                  >
                                    <UserPlus className="h-4 w-4 mr-2" />
                                    {student.accountStatus === 'invited' ? 'Resend invite' : 'Invite to claim'}
                                  </DropdownMenuItem>
                                )}
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

      {claimedStudents.length === 0 && students.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Parent linking is available after a student claims their account.
        </p>
      )}

      {selectedStudentIds.size > 0 && (
        <div className="sticky bottom-0 z-40 pt-2">
          <div className="bg-card border border-border rounded-lg shadow-lg p-4 flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-foreground">
              {selectedStudentIds.size} student{selectedStudentIds.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleClearSelection}>
                Clear Selection
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setBulkDeleteModalOpen(true)}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Selected
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Send Message Modal */}
      <SendMessageModal
        open={sendMessageModalOpen}
        onOpenChange={setSendMessageModalOpen}
        student={selectedStudent && selectedStudent.clerkId ? {
          id: selectedStudent.clerkId,
          name: selectedStudent.name,
          email: selectedStudent.email,
          avatar: selectedStudent.avatar,
        } : null}
        onMessageSent={() => {
          toast.success('Message sent successfully')
        }}
      />

      <CreateStudentModal
        open={createStudentModalOpen}
        onOpenChange={setCreateStudentModalOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['students'] })
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
        students={claimedStudents.map((student) => ({
          _id: student.dbId,
          clerk_id: student.clerkId,
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

      <ConfirmDeleteModal
        open={bulkDeleteModalOpen}
        onOpenChange={setBulkDeleteModalOpen}
        onConfirm={handleBulkDeleteStudents}
        title="Delete selected students?"
        description={`This will archive ${selectedStudentIds.size} selected student${selectedStudentIds.size === 1 ? '' : 's'}. This action cannot be undone.`}
        loading={bulkDeleting}
      />
    </div>
  )
}
