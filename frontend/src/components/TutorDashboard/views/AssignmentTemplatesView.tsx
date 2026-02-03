import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, Search, MoreVertical, Edit, Trash2, Eye, Copy, FileText } from 'lucide-react'
import { useApiClient } from '@/lib/api-client'
import { toast } from '@/contexts/ToastContext'
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal'

interface AssignmentTemplate {
  _id: string
  name: string
  description: string
  subject_id: {
    _id: string
    name: string
  }
  question_ids: string[]
  duration_minutes?: number
  passing_score: number
  allow_retakes: boolean
  shuffle_questions: boolean
  show_correct_answers: boolean
  instructions?: string
  tags: string[]
  status: 'active' | 'archived' | 'draft'
  usage_count: number
  created_at: string
  updated_at: string
}

export default function AssignmentTemplatesView() {
  const client = useApiClient()
  const [templates, setTemplates] = useState<AssignmentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [templateToDelete, setTemplateToDelete] = useState<AssignmentTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true)
      const response = await client.get('/assignment-templates/')

      if (response.error) throw new Error(response.error)

      const data = response.data
      setTemplates(data.templates || [])
    } catch (error) {
      console.error('Failed to load templates:', error)
      toast.error('Failed to load templates')
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const handleDelete = async () => {
    if (!templateToDelete) return

    try {
      setDeleting(true)
      const response = await client.delete(`/assignment-templates/${templateToDelete._id}`)

      if (response.error) throw new Error(response.error)

      toast.success('Template deleted successfully')
      setTemplates(templates.filter(t => t._id !== templateToDelete._id))
      setDeleteModalOpen(false)
      setTemplateToDelete(null)
    } catch (error) {
      console.error('Failed to delete template:', error)
      toast.error('Failed to delete template')
    } finally {
      setDeleting(false)
    }
  }

  const handleUseTemplate = async (templateId: string) => {
    try {
      const response = await client.post(`/assignment-templates/${templateId}/use`)

      if (response.error) throw new Error(response.error)

      toast.success('Template loaded', {
        description: 'Redirecting to create assignment...'
      })
      // TODO: Navigate to create assignment with template data
    } catch (error) {
      console.error('Failed to use template:', error)
      toast.error('Failed to use template')
    }
  }

  const handleView = (templateId: string) => {
    toast.info('View template details coming soon')
  }

  const handleEdit = (templateId: string) => {
    toast.info('Edit template coming soon')
  }

  const filteredTemplates = templates.filter(template =>
    template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    template.description?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/10 text-green-600 dark:text-green-400 border-0'
      case 'draft': return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-0'
      case 'archived': return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-0'
      default: return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-0'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Assignment Templates</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage reusable assignment templates
          </p>
        </div>
        <Button
          onClick={() => toast.info('Create template coming soon')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Template
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          placeholder="Search templates..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 bg-muted/50"
        />
      </div>

      {/* Templates Table */}
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
                      {searchTerm ? 'No templates found matching your search' : 'No templates yet. Create your first template to get started.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTemplates.map((template) => (
                    <TableRow key={template._id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-medium text-foreground">
                        <div>
                          <p className="font-semibold">{template.name}</p>
                          {template.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                              {template.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-foreground">
                        {template.subject_id?.name || 'N/A'}
                      </TableCell>
                      <TableCell className="text-foreground">
                        {template.question_ids?.length || 0}
                      </TableCell>
                      <TableCell className="text-foreground">
                        {template.usage_count || 0}x
                      </TableCell>
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
                            <DropdownMenuItem onClick={() => handleUseTemplate(template._id)}>
                              <Copy className="w-4 h-4 mr-2" />
                              Use Template
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleView(template._id)}>
                              <Eye className="w-4 h-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleEdit(template._id)}>
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
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal */}
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


