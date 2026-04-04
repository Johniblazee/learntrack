import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  BookOpen,
  FileText,
  Users,
  HelpCircle,
  Eye,
} from 'lucide-react'
import { toast } from '@/contexts/ToastContext'
import { LoadingSpinner } from '@/components/ui/loading-state'
import {
  useSubjects,
  useCreateSubject,
  useUpdateSubject,
  useDeleteSubject,
} from '@/hooks/useQueries'

interface SubjectRecord {
  _id?: string
  id?: string
  name: string
  description?: string
  topics?: string[]
  question_count?: number
  is_active?: boolean
  created_at?: string
}

export default function SubjectsView() {
  const navigate = useNavigate()
  const { data: subjectsData, isLoading } = useSubjects()
  const createSubject = useCreateSubject()
  const updateSubject = useUpdateSubject()
  const deleteSubject = useDeleteSubject()

  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [selectedSubject, setSelectedSubject] = useState<SubjectRecord | null>(null)
  const [formData, setFormData] = useState({ name: '', description: '' })

  const subjects: SubjectRecord[] = useMemo(() => {
    const raw = Array.isArray(subjectsData) ? subjectsData : (subjectsData as any)?.items || []
    return raw as SubjectRecord[]
  }, [subjectsData])

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return subjects
    const term = searchTerm.toLowerCase()
    return subjects.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        s.description?.toLowerCase().includes(term) ||
        s.topics?.some((t) => t.toLowerCase().includes(term))
    )
  }, [subjects, searchTerm])

  const getSubjectId = (s: SubjectRecord) => s._id || s.id || ''

  const openCreate = () => {
    setFormData({ name: '', description: '' })
    setShowCreateDialog(true)
  }

  const openEdit = (subject: SubjectRecord) => {
    setSelectedSubject(subject)
    setFormData({ name: subject.name, description: subject.description || '' })
    setShowEditDialog(true)
  }

  const openDelete = (subject: SubjectRecord) => {
    setSelectedSubject(subject)
    setShowDeleteDialog(true)
  }

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast.error('Subject name is required')
      return
    }
    try {
      await createSubject.mutateAsync({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
      })
      toast.success('Subject created')
      setShowCreateDialog(false)
    } catch (err: any) {
      toast.error('Failed to create subject', { description: err.message })
    }
  }

  const handleUpdate = async () => {
    if (!selectedSubject || !formData.name.trim()) return
    try {
      await updateSubject.mutateAsync({
        id: getSubjectId(selectedSubject),
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
      })
      toast.success('Subject updated')
      setShowEditDialog(false)
      setSelectedSubject(null)
    } catch (err: any) {
      toast.error('Failed to update subject', { description: err.message })
    }
  }

  const handleDelete = async () => {
    if (!selectedSubject) return
    try {
      await deleteSubject.mutateAsync(getSubjectId(selectedSubject))
      toast.success('Subject deleted')
      setShowDeleteDialog(false)
      setSelectedSubject(null)
    } catch (err: any) {
      toast.error('Cannot delete subject', { description: err.message })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subjects</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage learning subjects with topics, then assign work to students.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create Subject
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search subjects..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold">
              {subjects.length === 0 ? 'No subjects yet' : 'No matching subjects'}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {subjects.length === 0
                ? 'Create your first subject to start organising questions and assignments.'
                : 'Try a different search term.'}
            </p>
            {subjects.length === 0 && (
              <Button onClick={openCreate} className="mt-4">
                <Plus className="mr-2 h-4 w-4" />
                Create Subject
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((subject) => {
            const id = getSubjectId(subject)
            return (
              <Card
                key={id}
                className="group relative overflow-hidden transition-shadow hover:shadow-md"
              >
                <CardContent className="p-5 space-y-4">
                  {/* Name & description */}
                  <div>
                    <h3 className="font-semibold text-base leading-tight line-clamp-1">
                      {subject.name}
                    </h3>
                    {subject.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {subject.description}
                      </p>
                    )}
                  </div>

                  {/* Topics */}
                  {subject.topics && subject.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {subject.topics.slice(0, 4).map((topic) => (
                        <Badge key={topic} variant="secondary" className="text-xs">
                          {topic}
                        </Badge>
                      ))}
                      {subject.topics.length > 4 && (
                        <Badge variant="outline" className="text-xs">
                          +{subject.topics.length - 4}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <HelpCircle className="h-3.5 w-3.5" />
                      {subject.question_count ?? 0} questions
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      {subject.topics?.length ?? 0} topics
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => navigate(`/dashboard/subjects/${id}`)}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      View
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigate(`/dashboard/assignments/create?subjectId=${id}`)
                      }
                    >
                      <FileText className="mr-1.5 h-3.5 w-3.5" />
                      Assign
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openEdit(subject)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => openDelete(subject)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Subject</DialogTitle>
            <DialogDescription>
              Add a new subject to organise your questions and assignments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="create-name">Name</Label>
              <Input
                id="create-name"
                placeholder="e.g. Mathematics"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-desc">Description (optional)</Label>
              <Textarea
                id="create-desc"
                placeholder="Brief description of the subject..."
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={createSubject.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createSubject.isPending || !formData.name.trim()}
            >
              {createSubject.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Subject</DialogTitle>
            <DialogDescription>Update the subject name or description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-desc">Description (optional)</Label>
              <Textarea
                id="edit-desc"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              disabled={updateSubject.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateSubject.isPending || !formData.name.trim()}
            >
              {updateSubject.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Subject</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{selectedSubject?.name}</strong>? This
              cannot be undone. Subjects with existing questions or assignments cannot be
              deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteSubject.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteSubject.isPending}
            >
              {deleteSubject.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
