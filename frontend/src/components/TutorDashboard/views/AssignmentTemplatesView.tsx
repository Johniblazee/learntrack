import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Plus,
  Search,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
  Copy,
  ListChecks,
} from "lucide-react"
import { useApiClient } from "@/lib/api-client"
import { toast } from "@/contexts/ToastContext"
import { ConfirmDeleteModal } from "@/components/modals/ConfirmDeleteModal"
import QuestionBankSelector, { QuestionItem } from "@/components/QuestionBankSelector"
import { useSubjects } from "@/hooks/useQueries"

interface AssignmentTemplate {
  id?: string
  _id?: string
  name: string
  description?: string
  subject_id: string | { id?: string; _id?: string; name?: string }
  question_ids: string[]
  duration_minutes?: number
  passing_score: number
  allow_retakes: boolean
  shuffle_questions: boolean
  show_correct_answers: boolean
  instructions?: string
  tags: string[]
  status: "active" | "archived" | "draft"
  usage_count: number
  created_at: string
  updated_at: string
}

interface SubjectOption {
  id: string
  name: string
}

interface TemplateEditorState {
  name: string
  description: string
  subjectId: string
  questionIds: string[]
  instructions: string
  tags: string
  status: "active" | "draft" | "archived"
}

const DEFAULT_EDITOR_STATE: TemplateEditorState = {
  name: "",
  description: "",
  subjectId: "",
  questionIds: [],
  instructions: "",
  tags: "",
  status: "active",
}

function getTemplateId(template: AssignmentTemplate): string {
  return String(template.id || template._id || "")
}

function getTemplateSubjectId(template: AssignmentTemplate): string {
  if (typeof template.subject_id === "string") return template.subject_id
  return template.subject_id?.id || template.subject_id?._id || ""
}

function parseTags(rawTags: string): string[] {
  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export default function AssignmentTemplatesView() {
  const client = useApiClient()
  const navigate = useNavigate()
  const { data: subjectsResponse } = useSubjects()

  const [templates, setTemplates] = useState<AssignmentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [templateToDelete, setTemplateToDelete] = useState<AssignmentTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create")
  const [editorState, setEditorState] = useState<TemplateEditorState>(DEFAULT_EDITOR_STATE)
  const [activeTemplate, setActiveTemplate] = useState<AssignmentTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const [questionSelectorOpen, setQuestionSelectorOpen] = useState(false)
  const [selectedQuestionData, setSelectedQuestionData] = useState<QuestionItem[]>([])

  const subjects: SubjectOption[] = (Array.isArray(subjectsResponse)
    ? subjectsResponse
    : (subjectsResponse as any)?.items || [])
    .map((subject: any) => ({
      id: String(subject.id || subject._id || ""),
      name: subject.name || "Untitled Subject",
    }))
    .filter((subject: SubjectOption) => subject.id)

  const resolveSubjectName = useCallback(
    (template: AssignmentTemplate) => {
      if (typeof template.subject_id === "object" && template.subject_id?.name) {
        return template.subject_id.name
      }

      const subjectId = getTemplateSubjectId(template)
      const match = subjects.find((subject) => subject.id === subjectId)
      return match?.name || "Unknown"
    },
    [subjects]
  )

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true)
      const response = await client.get("/assignment-templates/")

      if (response.error) throw new Error(response.error)

      const data = response.data
      setTemplates(data?.templates || [])
    } catch (error) {
      console.error("Failed to load templates:", error)
      toast.error("Failed to load templates")
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const openCreateEditor = () => {
    setEditorMode("create")
    setActiveTemplate(null)
    setEditorState(DEFAULT_EDITOR_STATE)
    setSelectedQuestionData([])
    setEditorOpen(true)
  }

  const openEditEditor = (template: AssignmentTemplate) => {
    setEditorMode("edit")
    setActiveTemplate(template)
    setEditorState({
      name: template.name || "",
      description: template.description || "",
      subjectId: getTemplateSubjectId(template),
      questionIds: template.question_ids || [],
      instructions: template.instructions || "",
      tags: (template.tags || []).join(", "),
      status: template.status || "active",
    })
    setSelectedQuestionData([])
    setEditorOpen(true)
  }

  const openDetails = (template: AssignmentTemplate) => {
    setActiveTemplate(template)
    setDetailsOpen(true)
  }

  const handleDelete = async () => {
    if (!templateToDelete) return

    try {
      setDeleting(true)
      const templateId = getTemplateId(templateToDelete)
      const response = await client.delete(`/assignment-templates/${templateId}`)

      if (response.error) throw new Error(response.error)

      toast.success("Template deleted successfully")
      setTemplates((prev) => prev.filter((template) => getTemplateId(template) !== templateId))
      setDeleteModalOpen(false)
      setTemplateToDelete(null)
    } catch (error) {
      console.error("Failed to delete template:", error)
      toast.error("Failed to delete template")
    } finally {
      setDeleting(false)
    }
  }

  const handleSaveTemplate = async () => {
    if (!editorState.name.trim()) {
      toast.error("Template name is required")
      return
    }

    if (!editorState.subjectId) {
      toast.error("Please select a subject")
      return
    }

    try {
      setSaving(true)

      const payload = {
        name: editorState.name.trim(),
        description: editorState.description.trim() || undefined,
        subject_id: editorState.subjectId,
        question_ids: editorState.questionIds,
        instructions: editorState.instructions.trim() || undefined,
        tags: parseTags(editorState.tags),
        status: editorState.status,
      }

      const templateId = activeTemplate ? getTemplateId(activeTemplate) : null
      const response =
        editorMode === "create"
          ? await client.post("/assignment-templates/", payload)
          : await client.put(`/assignment-templates/${templateId}`, payload)

      if (response.error) throw new Error(response.error)

      toast.success(
        editorMode === "create" ? "Template created successfully" : "Template updated successfully"
      )

      setEditorOpen(false)
      setEditorState(DEFAULT_EDITOR_STATE)
      setActiveTemplate(null)
      setSelectedQuestionData([])
      await loadTemplates()
    } catch (error) {
      console.error("Failed to save template:", error)
      toast.error(editorMode === "create" ? "Failed to create template" : "Failed to update template")
    } finally {
      setSaving(false)
    }
  }

  const handleUseTemplate = async (template: AssignmentTemplate) => {
    try {
      const templateId = getTemplateId(template)
      const response = await client.post(`/assignment-templates/${templateId}/use`)

      if (response.error) throw new Error(response.error)

      toast.success("Template loaded", {
        description: "Prefilling assignment form",
      })

      navigate("/dashboard/assignments/create", {
        state: {
          template: {
            ...template,
            usage_count: (template.usage_count || 0) + 1,
          },
        },
      })
    } catch (error) {
      console.error("Failed to use template:", error)
      toast.error("Failed to use template")
    }
  }

  const filteredTemplates = templates.filter((template) => {
    const query = searchTerm.toLowerCase()
    return (
      template.name.toLowerCase().includes(query) ||
      template.description?.toLowerCase().includes(query)
    )
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-0"
      case "draft":
        return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-0"
      case "archived":
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-0"
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-0"
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Assignment Templates</h1>
          <p className="text-muted-foreground mt-1">Create and manage reusable assignment templates</p>
        </div>
        <Button onClick={openCreateEditor} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Create Template
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          placeholder="Search templates..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="pl-10 bg-muted/50"
        />
      </div>

      <Card className="border-0 shadow-sm bg-card">
        <CardContent className="p-0">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Template Name</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Questions</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-48 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-24 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-16 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-16 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-6 bg-muted rounded w-20 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-8 bg-muted rounded w-8 animate-pulse ml-auto"></div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredTemplates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      {searchTerm
                        ? "No templates found matching your search"
                        : "No templates yet. Create your first template to get started."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTemplates.map((template) => {
                    const templateId = getTemplateId(template)
                    return (
                      <TableRow key={templateId} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="font-medium text-foreground">
                          <div>
                            <p className="font-semibold">{template.name}</p>
                            {template.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{template.description}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-foreground">{resolveSubjectName(template)}</TableCell>
                        <TableCell className="text-foreground">{template.question_ids?.length || 0}</TableCell>
                        <TableCell className="text-foreground">{template.usage_count || 0}x</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(template.status)}>
                            {template.status.charAt(0).toUpperCase() + template.status.slice(1)}
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
                              <DropdownMenuItem onClick={() => handleUseTemplate(template)}>
                                <Copy className="w-4 h-4 mr-2" />
                                Use Template
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDetails(template)}>
                                <Eye className="w-4 h-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditEditor(template)}>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setTemplateToDelete(template)
                                  setDeleteModalOpen(true)
                                }}
                                className="text-red-600 dark:text-red-500"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editorMode === "create" ? "Create Template" : "Edit Template"}</DialogTitle>
            <DialogDescription>
              Save reusable assignment settings so you can launch new assignments faster.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name</Label>
              <Input
                id="template-name"
                value={editorState.name}
                onChange={(event) => setEditorState((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="e.g., Weekly Algebra Practice"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-subject">Subject</Label>
              <Select
                value={editorState.subjectId}
                onValueChange={(value) => setEditorState((prev) => ({ ...prev, subjectId: value }))}
              >
                <SelectTrigger id="template-subject">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-description">Description</Label>
              <Textarea
                id="template-description"
                value={editorState.description}
                onChange={(event) =>
                  setEditorState((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="Optional short description"
                rows={2}
              />
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Question Set</p>
                  <p className="text-xs text-muted-foreground">
                    {editorState.questionIds.length} question{editorState.questionIds.length === 1 ? "" : "s"} selected
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={() => setQuestionSelectorOpen(true)}>
                  <ListChecks className="h-4 w-4 mr-2" />
                  Select Questions
                </Button>
              </div>
              {selectedQuestionData.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Last selected: {selectedQuestionData[0].text.slice(0, 80)}
                  {selectedQuestionData[0].text.length > 80 ? "..." : ""}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-instructions">Instructions</Label>
              <Textarea
                id="template-instructions"
                value={editorState.instructions}
                onChange={(event) =>
                  setEditorState((prev) => ({ ...prev, instructions: event.target.value }))
                }
                placeholder="Optional instructions shown to students"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="template-tags">Tags</Label>
                <Input
                  id="template-tags"
                  value={editorState.tags}
                  onChange={(event) => setEditorState((prev) => ({ ...prev, tags: event.target.value }))}
                  placeholder="algebra, warmup"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-status">Status</Label>
                <Select
                  value={editorState.status}
                  onValueChange={(value: "active" | "draft" | "archived") =>
                    setEditorState((prev) => ({ ...prev, status: value }))
                  }
                >
                  <SelectTrigger id="template-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveTemplate} disabled={saving}>
              {saving ? "Saving..." : editorMode === "create" ? "Create Template" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{activeTemplate?.name || "Template"}</DialogTitle>
            <DialogDescription>Template details and assignment defaults.</DialogDescription>
          </DialogHeader>

          {activeTemplate && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">Subject</p>
                <p className="font-medium">{resolveSubjectName(activeTemplate)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Description</p>
                <p className="font-medium">{activeTemplate.description || "No description"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Questions</p>
                <p className="font-medium">{activeTemplate.question_ids?.length || 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Instructions</p>
                <p className="font-medium whitespace-pre-wrap">{activeTemplate.instructions || "No instructions"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Tags</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {activeTemplate.tags?.length ? (
                    activeTemplate.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="font-medium">No tags</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <QuestionBankSelector
        open={questionSelectorOpen}
        onOpenChange={setQuestionSelectorOpen}
        selectedQuestions={editorState.questionIds}
        onConfirm={(questionIds, questionData) => {
          setEditorState((prev) => ({ ...prev, questionIds }))
          setSelectedQuestionData(questionData)
        }}
      />

      <ConfirmDeleteModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        onConfirm={handleDelete}
        title="Delete Template?"
        description="Are you sure you want to delete this template? This action cannot be undone."
        itemName={templateToDelete?.name}
        loading={deleting}
      />
    </div>
  )
}
