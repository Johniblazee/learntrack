import { useState, useEffect, useMemo } from 'react'
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
import { Edit, Search, X, Users, UserPlus, RefreshCw, Loader2 } from 'lucide-react'
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'

interface Student {
  _id: string
  clerk_id: string
  name: string
  email: string
  avatar_url?: string
}

interface Group {
  _id: string
  name: string
  description?: string
  studentIds?: string[]
  imageUrl?: string
  color?: string
}

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
  const [loading, setLoading] = useState(false)
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [regeneratingImage, setRegeneratingImage] = useState(false)
  const [allStudents, setAllStudents] = useState<Student[]>([])
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddStudents, setShowAddStudents] = useState(false)
  const client = useApiClient()

  // Fetch all students when modal opens
  useEffect(() => {
    if (open && group) {
      setName(group.name)
      setDescription(group.description || '')
      setImageUrl(group.imageUrl || '')
      // Filter out any null/undefined values from studentIds
      const validStudentIds = (group.studentIds || []).filter((id): id is string => id != null && id !== '')
      setSelectedStudentIds(validStudentIds)
      fetchAllStudents()
    }
  }, [open, group])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setSearchTerm('')
      setShowAddStudents(false)
    }
  }, [open])

  const fetchAllStudents = async () => {
    try {
      setLoadingStudents(true)
      const response = await client.get('/students?per_page=100')
      if (response.error) throw new Error(response.error)
      setAllStudents(response.data?.items || [])
    } catch (error) {
      console.error('Failed to fetch students:', error)
      toast.error('Failed to load students')
    } finally {
      setLoadingStudents(false)
    }
  }

  // Get current members
  const currentMembers = useMemo(() => {
    return allStudents.filter(s => selectedStudentIds.includes(s._id))
  }, [allStudents, selectedStudentIds])

  // Get available students (not in group)
  const availableStudents = useMemo(() => {
    return allStudents.filter(s => !selectedStudentIds.includes(s._id))
  }, [allStudents, selectedStudentIds])

  // Filter available students by search
  const filteredAvailableStudents = useMemo(() => {
    if (!searchTerm.trim()) return availableStudents
    const term = searchTerm.toLowerCase()
    return availableStudents.filter(
      s => s.name.toLowerCase().includes(term) || s.email.toLowerCase().includes(term)
    )
  }, [availableStudents, searchTerm])

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const handleAddStudent = (studentId: string) => {
    setSelectedStudentIds(prev => [...prev, studentId])
  }

  const handleRemoveStudent = (studentId: string) => {
    setSelectedStudentIds(prev => prev.filter(id => id !== studentId))
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
        studentIds: selectedStudentIds
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
                        <Loader2 className="h-4 w-4 animate-spin" />
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
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
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

            {/* Add Students Panel */}
            {showAddStudents && (
              <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search students to add..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
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
                          onClick={() => handleAddStudent(student._id)}
                        >
                          <Checkbox
                            checked={false}
                            onCheckedChange={() => handleAddStudent(student._id)}
                          />
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={student.avatar_url} alt={student.name} />
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">
                              {getInitials(student.name)}
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
                          {getInitials(student.name)}
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
                        onClick={() => handleRemoveStudent(student._id)}
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
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

