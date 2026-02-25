import { useMemo, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/contexts/ToastContext'
import { useSubjects } from '@/hooks/useQueries'
import { BookOpen, Edit, Plus, Search, Tag, Trash2 } from 'lucide-react'
import { API_BASE_URL } from '@/lib/config'

interface SubjectRecord {
  _id: string
  name: string
  description?: string
  topics: string[]
  is_active?: boolean
  question_count?: number
}

type TopicEditState = {
  subjectId: string
  originalName?: string
  topicName: string
}

export default function IntegratedSubjectsManager() {
  const { getToken } = useAuth()
  const queryClient = useQueryClient()

  const { data: subjectsData, isLoading } = useSubjects()

  const subjects = useMemo<SubjectRecord[]>(() => {
    if (!Array.isArray(subjectsData)) {
      return []
    }

    return subjectsData.map((subject: any) => ({
      _id: subject._id || subject.id,
      name: subject.name || 'Untitled Subject',
      description: subject.description || '',
      topics: Array.isArray(subject.topics) ? subject.topics : [],
      is_active: subject.is_active !== false,
      question_count: Number(subject.question_count || 0),
    }))
  }, [subjectsData])

  const [searchTerm, setSearchTerm] = useState('')
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('')

  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false)
  const [topicDialogOpen, setTopicDialogOpen] = useState(false)

  const [editingSubject, setEditingSubject] = useState<SubjectRecord | null>(null)
  const [editingTopic, setEditingTopic] = useState<TopicEditState | null>(null)

  const [subjectForm, setSubjectForm] = useState({
    name: '',
    description: '',
  })
  const [topicForm, setTopicForm] = useState<TopicEditState>({
    subjectId: '',
    topicName: '',
  })

  const [isSubmitting, setIsSubmitting] = useState(false)

  const selectedSubject = subjects.find((subject) => subject._id === selectedSubjectId)

  const filteredSubjects = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) {
      return subjects
    }

    return subjects.filter((subject) => {
      const matchesName = subject.name.toLowerCase().includes(query)
      const matchesDescription = (subject.description || '').toLowerCase().includes(query)
      const matchesTopic = subject.topics.some((topic) => topic.toLowerCase().includes(query))
      return matchesName || matchesDescription || matchesTopic
    })
  }, [searchTerm, subjects])

  const totalTopics = useMemo(
    () => subjects.reduce((count, subject) => count + subject.topics.length, 0),
    [subjects],
  )

  const refreshSubjects = () => {
    queryClient.invalidateQueries({ queryKey: ['subjects'] })
  }

  const request = async (path: string, init?: RequestInit) => {
    const token = await getToken()
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      const detail = payload?.detail || payload?.message || 'Request failed'
      throw new Error(String(detail))
    }

    if (response.status === 204) {
      return null
    }

    return response.json().catch(() => null)
  }

  const openCreateSubject = () => {
    setEditingSubject(null)
    setSubjectForm({ name: '', description: '' })
    setSubjectDialogOpen(true)
  }

  const openEditSubject = (subject: SubjectRecord) => {
    setEditingSubject(subject)
    setSubjectForm({
      name: subject.name,
      description: subject.description || '',
    })
    setSubjectDialogOpen(true)
  }

  const saveSubject = async () => {
    const name = subjectForm.name.trim()
    if (!name) {
      toast.error('Subject name is required')
      return
    }

    try {
      setIsSubmitting(true)
      const payload = {
        name,
        description: subjectForm.description.trim() || null,
      }

      if (editingSubject) {
        await request(`/subjects/${editingSubject._id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
        toast.success('Subject updated')
      } else {
        await request('/subjects/', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        toast.success('Subject created')
      }

      setSubjectDialogOpen(false)
      refreshSubjects()
    } catch (error) {
      console.error('Failed to save subject:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to save subject')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteSubject = async (subject: SubjectRecord) => {
    const confirmed = window.confirm(
      `Delete subject "${subject.name}"? This cannot be undone.`,
    )
    if (!confirmed) {
      return
    }

    try {
      await request(`/subjects/${subject._id}`, { method: 'DELETE' })
      toast.success('Subject deleted')
      if (selectedSubjectId === subject._id) {
        setSelectedSubjectId('')
      }
      refreshSubjects()
    } catch (error) {
      console.error('Failed to delete subject:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete subject')
    }
  }

  const openCreateTopic = () => {
    const defaultSubjectId = selectedSubjectId || subjects[0]?._id || ''
    setEditingTopic(null)
    setTopicForm({
      subjectId: defaultSubjectId,
      topicName: '',
    })
    setTopicDialogOpen(true)
  }

  const openEditTopic = (subjectId: string, topicName: string) => {
    setEditingTopic({
      subjectId,
      originalName: topicName,
      topicName,
    })
    setTopicForm({
      subjectId,
      originalName: topicName,
      topicName,
    })
    setTopicDialogOpen(true)
  }

  const saveTopic = async () => {
    const subjectId = topicForm.subjectId
    const topicName = topicForm.topicName.trim()

    if (!subjectId) {
      toast.error('Please select a subject')
      return
    }

    if (!topicName) {
      toast.error('Topic name is required')
      return
    }

    try {
      setIsSubmitting(true)

      if (editingTopic?.originalName) {
        const originalName = editingTopic.originalName
        if (originalName !== topicName || editingTopic.subjectId !== subjectId) {
          await request(
            `/subjects/${editingTopic.subjectId}/topics/${encodeURIComponent(originalName)}`,
            { method: 'DELETE' },
          )
          await request(`/subjects/${subjectId}/topics/${encodeURIComponent(topicName)}`, {
            method: 'POST',
          })
        }
        toast.success('Topic updated')
      } else {
        await request(`/subjects/${subjectId}/topics/${encodeURIComponent(topicName)}`, {
          method: 'POST',
        })
        toast.success('Topic created')
      }

      setTopicDialogOpen(false)
      if (!selectedSubjectId) {
        setSelectedSubjectId(subjectId)
      }
      refreshSubjects()
    } catch (error) {
      console.error('Failed to save topic:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to save topic')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteTopic = async (subjectId: string, topicName: string) => {
    const confirmed = window.confirm(`Delete topic "${topicName}"?`)
    if (!confirmed) {
      return
    }

    try {
      await request(`/subjects/${subjectId}/topics/${encodeURIComponent(topicName)}`, {
        method: 'DELETE',
      })
      toast.success('Topic deleted')
      refreshSubjects()
    } catch (error) {
      console.error('Failed to delete topic:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete topic')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Subjects Manager</h1>
          <p className="text-muted-foreground mt-1">
            Manage subjects and topics used in assignment and question workflows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openCreateTopic} disabled={subjects.length === 0}>
            <Tag className="w-4 h-4 mr-2" />
            Add Topic
          </Button>
          <Button onClick={openCreateSubject}>
            <Plus className="w-4 h-4 mr-2" />
            Add Subject
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Total Subjects</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{subjects.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Total Topics</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{totalTopics}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Active Subjects</p>
            <p className="text-2xl font-semibold text-foreground mt-1">
              {subjects.filter((subject) => subject.is_active !== false).length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search subjects or topics..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              Subjects
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="rounded-lg border border-border p-4 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))
            ) : filteredSubjects.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No subjects found
              </div>
            ) : (
              filteredSubjects.map((subject) => (
                <div
                  key={subject._id}
                  className={`rounded-lg border p-4 transition-colors ${
                    selectedSubjectId === subject._id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedSubjectId(subject._id)}
                      className="text-left flex-1"
                    >
                      <p className="font-medium text-foreground">{subject.name}</p>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {subject.description || 'No description'}
                      </p>
                    </button>
                    <div className="flex items-center gap-1">
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
                    <Badge variant="secondary">{subject.topics.length} topics</Badge>
                    <Badge variant="outline">{subject.question_count || 0} questions</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <Tag className="w-5 h-5" />
                Topics
              </span>
              <Button size="sm" onClick={openCreateTopic} disabled={subjects.length === 0}>
                <Plus className="w-4 h-4 mr-1" />
                Add Topic
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedSubject ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Select a subject to manage its topics
              </div>
            ) : selectedSubject.topics.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No topics yet for {selectedSubject.name}
              </div>
            ) : (
              <div className="space-y-2">
                {selectedSubject.topics.map((topic) => (
                  <div
                    key={topic}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                  >
                    <span className="text-sm font-medium text-foreground">{topic}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditTopic(selectedSubject._id, topic)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteTopic(selectedSubject._id, topic)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
                onChange={(event) =>
                  setSubjectForm((previous) => ({ ...previous, name: event.target.value }))
                }
                placeholder="e.g., Mathematics"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject-description">Description</Label>
              <Textarea
                id="subject-description"
                value={subjectForm.description}
                onChange={(event) =>
                  setSubjectForm((previous) => ({ ...previous, description: event.target.value }))
                }
                rows={4}
                placeholder="Optional description"
              />
            </div>

            <Button className="w-full" onClick={saveSubject} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : editingSubject ? 'Save Subject' : 'Create Subject'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={topicDialogOpen} onOpenChange={setTopicDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTopic ? 'Edit Topic' : 'Create Topic'}</DialogTitle>
            <DialogDescription>
              {editingTopic
                ? 'Rename this topic or move it to another subject.'
                : 'Add a topic under one subject.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="topic-subject">Subject</Label>
              <Select
                value={topicForm.subjectId}
                onValueChange={(value) =>
                  setTopicForm((previous) => ({ ...previous, subjectId: value }))
                }
              >
                <SelectTrigger id="topic-subject">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((subject) => (
                    <SelectItem key={subject._id} value={subject._id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="topic-name">Topic Name</Label>
              <Input
                id="topic-name"
                value={topicForm.topicName}
                onChange={(event) =>
                  setTopicForm((previous) => ({ ...previous, topicName: event.target.value }))
                }
                placeholder="e.g., Linear Equations"
              />
            </div>

            <Button className="w-full" onClick={saveTopic} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : editingTopic ? 'Save Topic' : 'Create Topic'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
