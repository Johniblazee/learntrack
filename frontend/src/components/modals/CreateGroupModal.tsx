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
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Search, UserPlus, Users, X } from 'lucide-react'
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { useSubjects } from '@/hooks/useQueries'
import {
  getGroupMemberIdentifiers,
  getStudentInitials,
  GroupMemberStudent,
  useGroupMembers,
} from './group-members-shared'

interface CreateGroupModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGroupCreated?: () => void
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

export function CreateGroupModal({
  open,
  onOpenChange,
  onGroupCreated,
}: CreateGroupModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([])
  const [color, setColor] = useState<(typeof GROUP_COLORS)[number]>('blue')
  const [shouldGenerateImage, setShouldGenerateImage] = useState(true)
  const [showAddStudents, setShowAddStudents] = useState(false)
  const [loading, setLoading] = useState(false)
  const client = useApiClient()
  const { data: subjectsResponse } = useSubjects()
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
    initialMemberIds: [],
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

  useEffect(() => {
    if (!open) {
      setName('')
      setDescription('')
      setSelectedSubjects([])
      setColor('blue')
      setShouldGenerateImage(true)
      setShowAddStudents(false)
      setSearchTerm('')
      setMemberIds([])
    }
  }, [open, setMemberIds, setSearchTerm])

  const handleToggleSubject = (subjectName: string) => {
    setSelectedSubjects((previous) =>
      previous.includes(subjectName)
        ? previous.filter((subject) => subject !== subjectName)
        : [...previous, subjectName]
    )
  }

  const handleAddStudent = (student: GroupMemberStudent) => {
    setMemberIds((previous) => {
      if (getGroupMemberIdentifiers(student).some((identifier) => previous.includes(identifier))) {
        return previous
      }
      return [...previous, student._id]
    })
  }

  const handleRemoveStudent = (student: GroupMemberStudent) => {
    const identifiersToRemove = new Set(getGroupMemberIdentifiers(student))
    setMemberIds((previous) => previous.filter((identifier) => !identifiersToRemove.has(identifier)))
  }

  const handleAddVisibleStudents = () => {
    setMemberIds((previous) => {
      const next = new Set(previous)
      filteredAvailableStudents.forEach((student) => {
        next.add(student._id)
      })
      return [...next]
    })
  }

  const handleClearMembers = () => {
    setMemberIds([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) return

    try {
      setLoading(true)

      const response = await client.post(
        `/groups/?generate_image=${shouldGenerateImage ? 'true' : 'false'}`,
        {
          name: name.trim(),
          description: description.trim(),
          studentIds: memberIds,
          subjects: selectedSubjects,
          color,
        }
      )

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Group created successfully!', {
        description: `${name.trim()} has been added to your groups.`,
      })

      onOpenChange(false)
      onGroupCreated?.()
    } catch (error: any) {
      console.error('Failed to create group:', error)
      toast.error('Failed to create group', {
        description: error.message || 'Please try again or contact support if the issue persists.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Create Student Group
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">Group Name *</Label>
            <Input
              id="group-name"
              placeholder="e.g., Advanced Mathematics"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="group-description">Description</Label>
            <Textarea
              id="group-description"
              placeholder="Describe the purpose of this group..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="group-color">Color</Label>
              <Select value={color} onValueChange={(value: (typeof GROUP_COLORS)[number]) => setColor(value)}>
                <SelectTrigger id="group-color">
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

            <div className="rounded-lg border border-border p-3 bg-muted/30 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Cover Image</p>
                <p className="text-xs text-muted-foreground">
                  {shouldGenerateImage ? 'Generate an image automatically' : 'Create without a generated image'}
                </p>
              </div>
              <Switch checked={shouldGenerateImage} onCheckedChange={setShouldGenerateImage} />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Subjects</p>
                <p className="text-xs text-muted-foreground">
                  {selectedSubjects.length} selected
                </p>
              </div>
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

          <div className="flex-1 overflow-hidden flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Members
                <Badge variant="secondary" className="ml-1">
                  {memberIds.length}
                </Badge>
              </Label>
              <div className="flex items-center gap-2">
                {memberIds.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={handleClearMembers}>
                    Clear
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddStudents((previous) => !previous)}
                  className="gap-1"
                >
                  <UserPlus className="h-4 w-4" />
                  {showAddStudents ? 'Hide' : 'Add Students'}
                </Button>
              </div>
            </div>

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
                      {[1, 2, 3].map((index) => (
                        <div key={index} className="flex items-center gap-2">
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
                      {filteredAvailableStudents.map((student) => (
                        <div
                          key={student._id}
                          className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors"
                          onClick={() => handleAddStudent(student)}
                        >
                          <Checkbox checked={false} onCheckedChange={() => handleAddStudent(student)} />
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

            <ScrollArea className="flex-1 min-h-[100px] max-h-[220px] border rounded-lg">
              {loadingStudents ? (
                <div className="space-y-2 p-3">
                  {[1, 2, 3].map((index) => (
                    <div key={index} className="flex items-center gap-3">
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
                  <p className="text-xs">Click &quot;Add Students&quot; to add members</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {currentMembers.map((student) => (
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? 'Creating...' : 'Create Group'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
