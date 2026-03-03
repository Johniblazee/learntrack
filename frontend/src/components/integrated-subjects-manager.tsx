import { useMemo, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/contexts/ToastContext'
import { useSubjects } from '@/hooks/useQueries'
import { BookOpen, Edit, Plus, Search, Trash2 } from 'lucide-react'
import { API_BASE_URL } from '@/lib/config'

interface SubjectRecord {
  _id: string
  name: string
  description?: string
  topics: string[]
  is_active?: boolean
  question_count?: number
}

export default function IntegratedSubjectsManager() {
  const { getToken } = useAuth()
  const queryClient = useQueryClient()

  const { data: subjectsData, isLoading } = useSubjects()

  const subjects = useMemo<SubjectRecord[]>(() => {
    if (!Array.isArray(subjectsData)) return []
    return subjectsData.map((s: any) => ({
      _id: s._id || s.id,
      name: s.name || 'Untitled Subject',
      description: s.description || '',
      topics: Array.isArray(s.topics) ? s.topics : [],
      is_active: s.is_active !== false,
      question_count: Number(s.question_count || 0),
    }))
  }, [subjectsData])

  const [searchTerm, setSearchTerm] = useState('')
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false)
  const [editingSubject, setEditingSubject] = useState<SubjectRecord | null>(null)
  const [subjectForm, setSubjectForm] = useState({ name: '', description: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const filteredSubjects = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return subjects
    return subjects.filter((s) =>
      s.name.toLowerCase().includes(query) ||
      (s.description || '').toLowerCase().includes(query),
    )
  }, [searchTerm, subjects])

  const refreshSubjects = () => {
    queryClient.invalidateQueries({ queryKey: ['subjects'] })
  }

  const request = async (path: string, init?: RequestInit) => {
    const token = await getToken()
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => null)
      throw new Error(String(payload?.detail || payload?.message || 'Request failed'))
    }
    if (res.status === 204) return null
    return res.json().catch(() => null)
  }

  const openCreateSubject = () => {
    setEditingSubject(null)
    setSubjectForm({ name: '', description: '' })
    setSubjectDialogOpen(true)
  }

  const openEditSubject = (subject: SubjectRecord) => {
    setEditingSubject(subject)
    setSubjectForm({ name: subject.name, description: subject.description || '' })
    setSubjectDialogOpen(true)
  }

  const saveSubject = async () => {
    const name = subjectForm.name.trim()
    if (!name) { toast.error('Subject name is required'); return }
    try {
      setIsSubmitting(true)
      const payload = { name, description: subjectForm.description.trim() || null }
      if (editingSubject) {
        await request(`/subjects/${editingSubject._id}`, { method: 'PUT', body: JSON.stringify(payload) })
        toast.success('Subject updated')
      } else {
        await request('/subjects/', { method: 'POST', body: JSON.stringify(payload) })
        toast.success('Subject created')
      }
      setSubjectDialogOpen(false)
      refreshSubjects()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save subject')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteSubject = async (subject: SubjectRecord) => {
    if (!window.confirm(`Delete subject "${subject.name}"? This cannot be undone.`)) return
    try {
      await request(`/subjects/${subject._id}`, { method: 'DELETE' })
      toast.success('Subject deleted')
      refreshSubjects()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete subject')
    }
  }

  const activeCount = subjects.filter((s) => s.is_active !== false).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Subjects</h1>
          <p className="text-muted-foreground mt-1">
            Manage subjects used in assignments and question workflows.
          </p>
        </div>
        <Button onClick={openCreateSubject}>
          <Plus className="w-4 h-4 mr-2" />
          Add Subject
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Total Subjects</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{subjects.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Active Subjects</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{activeCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search subjects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Subjects list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Subjects
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border p-4 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))
          ) : filteredSubjects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {searchTerm ? 'No subjects match your search.' : 'No subjects yet. Create one to get started.'}
            </div>
          ) : (
            filteredSubjects.map((subject) => (
              <div
                key={subject._id}
                className="rounded-lg border border-border bg-card p-4 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{subject.name}</p>
                    {subject.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {subject.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => openEditSubject(subject)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteSubject(subject)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Badge variant="outline">{subject.question_count ?? 0} questions</Badge>
                  {subject.is_active === false && (
                    <Badge variant="secondary" className="text-muted-foreground">Inactive</Badge>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Subject create / edit dialog */}
      <Dialog open={subjectDialogOpen} onOpenChange={setSubjectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSubject ? 'Edit Subject' : 'Create Subject'}</DialogTitle>
            <DialogDescription>
              {editingSubject
                ? 'Update the subject details.'
                : 'Create a new subject for assignments and questions.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="subject-name">Subject Name</Label>
              <Input
                id="subject-name"
                value={subjectForm.name}
                onChange={(e) => setSubjectForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g., Mathematics"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject-description">Description</Label>
              <Textarea
                id="subject-description"
                value={subjectForm.description}
                onChange={(e) => setSubjectForm((p) => ({ ...p, description: e.target.value }))}
                rows={3}
                placeholder="Optional description"
              />
            </div>
            <Button className="w-full" onClick={saveSubject} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : editingSubject ? 'Save Subject' : 'Create Subject'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
