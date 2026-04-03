import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Users, Calendar, UserPlus, Search, X, BookOpen } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useApiClient } from '@/lib/api-client'
import { toast } from '@/contexts/ToastContext'
import { LoadingSpinner } from '@/components/ui/loading-state'
import {
  getGroupMemberIdentifiers,
  getStudentInitials,
  GroupMemberStudent,
  useGroupMembers,
} from './group-members-shared'

interface Group {
  _id: string
  name: string
  description?: string
  studentIds?: string[]
  subjects?: string[]
  created_at?: string
  createdDate?: string
  updated_at?: string
}

interface ViewGroupDetailsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: Group | null
  onGroupUpdated?: () => void
}

export function ViewGroupDetailsModal({
  open,
  onOpenChange,
  group,
  onGroupUpdated
}: ViewGroupDetailsModalProps) {
  const [showAddStudents, setShowAddStudents] = useState(false)
  const [saving, setSaving] = useState(false)
  const client = useApiClient()
  const {
    loadingStudents,
    memberIds,
    setMemberIds,
    currentMembers,
    filteredAvailableStudents,
    searchTerm,
    setSearchTerm,
  } = useGroupMembers({
    open,
    initialMemberIds: group?.studentIds || [],
  })

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setShowAddStudents(false)
      setSearchTerm('')
    }
  }, [open, setSearchTerm])

  const handleAddStudent = async (student: GroupMemberStudent) => {
    if (!group) return

    const previousMemberIds = [...memberIds]
    const newMemberIds = getGroupMemberIdentifiers(student).some((identifier) => memberIds.includes(identifier))
      ? memberIds
      : [...memberIds, student._id]
    setMemberIds(newMemberIds)

    // Immediately save to backend
    try {
      setSaving(true)
      const response = await client.put(`/groups/${group._id}`, {
        studentIds: newMemberIds
      })
      if (response.error) throw new Error(response.error)

      toast.success(`Added ${student?.name || 'student'} to group`)
      onGroupUpdated?.()
    } catch (error: any) {
      // Revert on error
      setMemberIds(previousMemberIds)
      toast.error('Failed to add student', {
        description: error.message
      })
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveStudent = async (student: GroupMemberStudent) => {
    if (!group) return

    const previousMemberIds = [...memberIds]
    const identifiersToRemove = new Set(getGroupMemberIdentifiers(student))
    const newMemberIds = memberIds.filter(id => !identifiersToRemove.has(id))
    setMemberIds(newMemberIds)

    // Immediately save to backend
    try {
      setSaving(true)
      const response = await client.put(`/groups/${group._id}`, {
        studentIds: newMemberIds
      })
      if (response.error) throw new Error(response.error)

      toast.success(`Removed ${student?.name || 'student'} from group`)
      onGroupUpdated?.()
    } catch (error: any) {
      // Revert on error
      setMemberIds(previousMemberIds)
      toast.error('Failed to remove student', {
        description: error.message
      })
    } finally {
      setSaving(false)
    }
  }

  const handleAddVisibleStudents = async () => {
    if (!group || filteredAvailableStudents.length === 0) return

    const previousMemberIds = [...memberIds]
    const nextMemberIds = Array.from(
      new Set([
        ...memberIds,
        ...filteredAvailableStudents.map((student) => student._id),
      ])
    )
    setMemberIds(nextMemberIds)

    try {
      setSaving(true)
      const response = await client.put(`/groups/${group._id}`, {
        studentIds: nextMemberIds,
      })
      if (response.error) throw new Error(response.error)

      toast.success('Students added to group', {
        description: `${filteredAvailableStudents.length} student${filteredAvailableStudents.length === 1 ? '' : 's'} added.`,
      })
      onGroupUpdated?.()
    } catch (error: any) {
      setMemberIds(previousMemberIds)
      toast.error('Failed to add students', {
        description: error.message,
      })
    } finally {
      setSaving(false)
    }
  }

  if (!group) return null

  const createdAt = group.created_at || group.createdDate

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {group.name}
            {saving && <LoadingSpinner size="sm" className="text-muted-foreground" />}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col space-y-4">
          {/* Group Info */}
          <div className="space-y-3">
            {group.description && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Description</p>
                <p className="text-foreground">{group.description}</p>
              </div>
            )}

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {createdAt && (
                  <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <span>
                    Created {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
                  </span>
                </div>
              )}
                <div className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  <span>{memberIds.length} students</span>
                </div>
                {group.subjects && group.subjects.length > 0 && (
                  <div className="flex items-center gap-1">
                    <BookOpen className="h-4 w-4" />
                    <span>{group.subjects.length} subjects</span>
                  </div>
                )}
              </div>

              {group.subjects && group.subjects.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {group.subjects.map((subject) => (
                    <Badge key={subject} variant="secondary">
                      {subject}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

          {/* Students Section */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Students</h3>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {memberIds.length} members
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddStudents(!showAddStudents)}
                  className="gap-1"
                  disabled={saving}
                >
                  <UserPlus className="h-4 w-4" />
                  {showAddStudents ? 'Hide' : 'Add'}
                </Button>
              </div>
            </div>

            {/* Add Students Panel */}
            {showAddStudents && (
              <div className="border rounded-lg p-3 bg-muted/30 space-y-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search students to add..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleAddVisibleStudents()}
                    disabled={saving || filteredAvailableStudents.length === 0}
                  >
                    Add All
                  </Button>
                </div>
                <ScrollArea className="h-[120px]">
                  {loadingStudents ? (
                    <div className="space-y-2 p-1">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="flex items-center gap-2">
                          <Skeleton className="h-8 w-8 rounded-full" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                      ))}
                    </div>
                  ) : filteredAvailableStudents.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {searchTerm ? 'No matching students found' : 'All students are already members'}
                    </p>
                  ) : (
                    <div className="space-y-1 p-1">
                      {filteredAvailableStudents.map(student => (
                        <div
                          key={student._id}
                          className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors"
                          onClick={() => !saving && handleAddStudent(student)}
                        >
                          <Checkbox
                            checked={false}
                            disabled={saving}
                            onCheckedChange={() => handleAddStudent(student)}
                          />
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={student.avatar_url} alt={student.name} />
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {getStudentInitials(student.name)}
                              </AvatarFallback>
                            </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{student.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}

            {/* Current Members List */}
            <ScrollArea className="flex-1 min-h-[150px]">
              {loadingStudents ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-3 p-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1">
                        <Skeleton className="h-4 w-32 mb-1" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : currentMembers.length > 0 ? (
                <div className="space-y-2">
                  {currentMembers.map((student) => (
                    <div
                      key={student._id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors group"
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={student.avatar_url} alt={student.name} />
                        <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                          {getStudentInitials(student.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{student.name}</p>
                        <p className="text-sm text-muted-foreground truncate">{student.email}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleRemoveStudent(student)}
                        disabled={saving}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No students in this group yet</p>
                  <p className="text-sm mt-1">Click "Add" to add students</p>
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
