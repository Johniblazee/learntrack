import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Edit, Search, X, Users, UserPlus, RefreshCw } from 'lucide-react'
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { useSubjects } from '@/hooks/useQueries'
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
  imageUrl?: string
  color?: string
  subjects?: string[]
}

interface SubjectOption {
  _id?: string
  id?: string
  name?: string
}

const GROUP_COLORS = [
  'blue',
  'green',
  'purple',
  'orange',
  'red',
  'pink',
  'yellow',
  'indigo',
] as const

interface EditGroupModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: Group | null
  onGroupUpdated?: () => void
}

export function EditGroupModal({
  open,
  onOpenChange,
  group,
  onGroupUpdated
}: EditGroupModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState<string>('')
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([])
  const [color, setColor] = useState<(typeof GROUP_COLORS)[number]>('blue')
  const [loading, setLoading] = useState(false)
  const [regeneratingImage, setRegeneratingImage] = useState(false)
  const [showAddStudents, setShowAddStudents] = useState(false)
  const client = useApiClient()
  const { data: subjectsResponse } = useSubjects()
  const {
    loadingStudents,
    memberIds: selectedStudentIds,
    setMemberIds: setSelectedStudentIds,
    currentMembers,
    filteredAvailableStudents,
    searchTerm,
    setSearchTerm,
  } = useGroupMembers({
    open,
    initialMemberIds: group?.studentIds || [],
  })

  const subjects = useMemo(() => {
    const source = Array.isArray(subjectsResponse)
      ? subjectsResponse
      : ((subjectsResponse as { items?: SubjectOption[] } | undefined)?.items || [])

    return source
      .map((subject) => ({
        id: String(subject._id || subject.id || '').trim(),
        name: String(subject.name || '').trim(),
      }))
      .filter((subject) => subject.id && subject.name)
  }, [subjectsResponse])

  // Fetch all students when modal opens
  useEffect(() => {
    if (open && group) {
      setName(group.name)
      setDescription(group.description || '')
      setImageUrl(group.imageUrl || '')
      setSelectedSubjects(group.subjects || [])
      setColor((group.color as (typeof GROUP_COLORS)[number]) || 'blue')
    }
  }, [open, group])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setSearchTerm('')
      setShowAddStudents(false)
      setSelectedSubjects([])
      setColor('blue')
    }
  }, [open, setSearchTerm])

  const handleAddStudent = (student: GroupMemberStudent) => {
    setSelectedStudentIds((prev) => {
      if (getGroupMemberIdentifiers(student).some((identifier) => prev.includes(identifier))) {
        return prev
      }
      return [...prev, student._id]
    })
  }

  const handleRemoveStudent = (student: GroupMemberStudent) => {
    const identifiersToRemove = new Set(getGroupMemberIdentifiers(student))
    setSelectedStudentIds((prev) => prev.filter((id) => !identifiersToRemove.has(id)))
  }

  const handleToggleSubject = (subjectName: string) => {
    setSelectedSubjects((prev) =>
      prev.includes(subjectName)
        ? prev.filter((subject) => subject !== subjectName)
        : [...prev, subjectName]
    )
  }

  const handleAddVisibleStudents = () => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev)
      filteredAvailableStudents.forEach((student) => {
        next.add(student._id)
      })
      return [...next]
    })
  }

  const handleClearMembers = () => {
    setSelectedStudentIds([])
  }

  const handleRegenerateImage = async () => {
    if (!group) return
    
    try {
      setRegeneratingImage(true)
      const response = await client.post(`/groups/${group._id}/regenerate-image`, {})
      
      if (response.error) {
        throw new Error(response.error)
      }

      setImageUrl(response.data?.imageUrl || '')
      toast.success('Cover image updated!')
    } catch (error: any) {
      console.error('Failed to regenerate image:', error)
      toast.error('Failed to update image', {
        description: error.message || 'Please try again'
      })
    } finally {
      setRegeneratingImage(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim() || !group) return

    try {
      setLoading(true)

      const response = await client.put(`/groups/${group._id}`, {
        name,
        description,
        studentIds: selectedStudentIds,
        subjects: selectedSubjects,
        color,
      })

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Group updated successfully!', {
        description: `Changes to ${name} have been saved.`
      })

      onOpenChange(false)
      onGroupUpdated?.()
    } catch (error: any) {
      console.error('Failed to update group:', error)
      toast.error('Failed to update group', {
        description: error.message || 'Please try again or contact support if the issue persists.'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5 text-primary" />
            Edit Group
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden space-y-4">
          {/* Image Preview Section */}
          <div className="space-y-2">
            <Label>Cover Image</Label>
            <div className="relative rounded-lg overflow-hidden border bg-muted/30 aspect-[2/1]">
              {imageUrl ? (
                <>
                  <img
                    src={imageUrl}
                    alt="Group cover"
                    className="w-full h-full object-cover"
                    onError={() => {
                      setImageUrl('')
                    }}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleRegenerateImage}
                      disabled={regeneratingImage}
                      className="bg-white/90 hover:bg-white text-foreground shadow-lg"
                    >
                      {regeneratingImage ? (
                        <LoadingSpinner size="sm" className="text-foreground" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span className="ml-1">Regenerate Image</span>
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <span className="text-sm text-muted-foreground">No cover image</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateImage}
                    disabled={regeneratingImage}
                  >
                    {regeneratingImage ? (
                      <LoadingSpinner size="sm" className="mr-1 text-foreground" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    Generate Image
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Group Name */}
          <div className="space-y-2">
            <Label htmlFor="edit-group-name">Group Name *</Label>
            <Input
              id="edit-group-name"
              placeholder="e.g., Advanced Mathematics"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="edit-group-description">Description</Label>
            <Textarea
              id="edit-group-description"
              placeholder="Describe the purpose of this group..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-group-color">Color</Label>
              <Select value={color} onValueChange={(value: (typeof GROUP_COLORS)[number]) => setColor(value)}>
                <SelectTrigger id="edit-group-color">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_COLORS.map((groupColor) => (
                    <SelectItem key={groupColor} value={groupColor}>
                      {groupColor.charAt(0).toUpperCase() + groupColor.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Subjects</p>
              <p className="text-xs text-muted-foreground">Tag the group with one or more subjects.</p>
            </div>
            {subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">Create subjects first to tag this group.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {subjects.map((subject) => (
                  <label
                    key={subject.id}
                    className="flex items-center gap-3 rounded-md border border-border p-2 text-sm cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selectedSubjects.includes(subject.name)}
                      onCheckedChange={() => handleToggleSubject(subject.name)}
                    />
                    <span>{subject.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Members Section */}
          <div className="flex-1 overflow-hidden flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Members
                <Badge variant="secondary" className="ml-1">
                  {selectedStudentIds.length}
                </Badge>
              </Label>
              <div className="flex items-center gap-2">
                {selectedStudentIds.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={handleClearMembers}>
                    Clear
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddStudents(!showAddStudents)}
                  className="gap-1"
                >
                  <UserPlus className="h-4 w-4" />
                  {showAddStudents ? 'Hide' : 'Add Students'}
                </Button>
              </div>
            </div>

            {/* Add Students Panel */}
            {showAddStudents && (
              <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
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
                    onClick={handleAddVisibleStudents}
                    disabled={filteredAvailableStudents.length === 0}
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
                          onClick={() => handleAddStudent(student)}
                        >
                          <Checkbox
                            checked={false}
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
            <ScrollArea className="flex-1 min-h-[100px] max-h-[200px] border rounded-lg">
              {loadingStudents ? (
                <div className="space-y-2 p-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1">
                        <Skeleton className="h-4 w-32 mb-1" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : currentMembers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Users className="h-10 w-10 mb-2 opacity-50" />
                  <p className="text-sm">No students in this group yet</p>
                  <p className="text-xs">Click "Add Students" to add members</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {currentMembers.map(student => (
                    <div
                      key={student._id}
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 group transition-colors"
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={student.avatar_url} alt={student.name} />
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {getStudentInitials(student.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{student.name}</p>
                        <p className="text-sm text-muted-foreground truncate">{student.email}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleRemoveStudent(student)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2 text-primary-foreground" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
