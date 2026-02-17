import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/contexts/ToastContext'
import {
  Upload,
  Trash2,
  Edit,
  Share2,
  FileText,
  FileImage,
  FileVideo,
  File,
  Link,
  CloudUpload,
  Search,
} from 'lucide-react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

interface Material {
  _id: string
  title: string
  description?: string
  material_type: 'pdf' | 'doc' | 'video' | 'link' | 'image' | 'other'
  file_url?: string
  file_size?: number
  subject_id?: string
  topic?: string
  tags: string[]
  status: 'active' | 'archived' | 'draft'
  view_count: number
  download_count: number
  created_at: string
  shared_with_students: boolean
}

interface Subject {
  _id: string
  name: string
}

// Helper function to get file icon based on type
const getFileIcon = (type: Material['material_type']) => {
  const iconClass = "w-5 h-5"
  switch (type) {
    case 'pdf':
      return <FileText className={`${iconClass} text-red-500`} />
    case 'doc':
      return <FileText className={`${iconClass} text-blue-500`} />
    case 'video':
      return <FileVideo className={`${iconClass} text-purple-500`} />
    case 'image':
      return <FileImage className={`${iconClass} text-green-500`} />
    case 'link':
      return <Link className={`${iconClass} text-cyan-500`} />
    default:
      return <File className={`${iconClass} text-gray-500`} />
  }
}

// Helper function to format file size
const formatFileSize = (bytes?: number) => {
  if (!bytes) return 'N/A'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function MaterialManager() {
  const { getToken } = useAuth()
  const [materials, setMaterials] = useState<Material[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploadingFile, setIsUploadingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    material_type: 'pdf' as Material['material_type'],
    file_url: '',
    subject_id: '',
    topic: '',
    tags: '',
    shared_with_students: true,
    file_size: 0
  })

  useEffect(() => {
    fetchMaterials()
    fetchSubjects()
  }, [])

  const fetchMaterials = async () => {
    try {
      setLoading(true)
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/materials/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        const data = await response.json()
        // API returns paginated response with items array
        setMaterials(data?.items || (Array.isArray(data) ? data : []))
      }
    } catch (error) {
      console.error('Failed to fetch materials:', error)
      toast.error('Failed to load materials')
    } finally {
      setLoading(false)
    }
  }

  const fetchSubjects = async () => {
    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/subjects/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        const data = await response.json()
        setSubjects(data)
      }
    } catch (error) {
      console.error('Failed to fetch subjects:', error)
    }
  }

  const handleCreateMaterial = async () => {
    try {
      const token = await getToken()

      let resolvedFileUrl = formData.file_url.trim()
      let resolvedFileSize = formData.file_size
      let resolvedMaterialType = formData.material_type

      if (!resolvedFileUrl && selectedFile) {
        setIsUploadingFile(true)
        const uploadFormData = new FormData()
        uploadFormData.append('file', selectedFile)

        const uploadResponse = await fetch(`${API_BASE_URL}/materials/upload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: uploadFormData,
        })

        const uploadPayload = await uploadResponse.json().catch(() => null)
        if (!uploadResponse.ok) {
          throw new Error(uploadPayload?.detail || 'Failed to upload file')
        }

        resolvedFileUrl = String(uploadPayload?.file_url || '')
        resolvedFileSize = Number(uploadPayload?.file_size || selectedFile.size)
        resolvedMaterialType = uploadPayload?.material_type || resolvedMaterialType
      }

      if (!resolvedFileUrl) {
        toast.error('Please upload a file or provide a file URL')
        return
      }

      const payload = {
        ...formData,
        file_url: resolvedFileUrl,
        file_size: resolvedFileSize,
        material_type: resolvedMaterialType,
        tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean)
      }

      const response = await fetch(`${API_BASE_URL}/materials/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        toast.success('Material created successfully')
        setIsCreateDialogOpen(false)
        setFormData({
          title: '',
          description: '',
          material_type: 'pdf',
          file_url: '',
          subject_id: '',
          topic: '',
          tags: '',
          shared_with_students: true,
          file_size: 0
        })
        setSelectedFile(null)
        fetchMaterials()
      } else {
        toast.error('Failed to create material')
      }
    } catch (error) {
      console.error('Failed to create material:', error)
      toast.error('Failed to create material')
    } finally {
      setIsUploadingFile(false)
    }
  }

  const handleDelete = async (materialId: string) => {
    if (!confirm('Are you sure you want to delete this material?')) return

    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/materials/${materialId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        toast.success('Material deleted')
        fetchMaterials()
      } else {
        toast.error('Failed to delete material')
      }
    } catch (error) {
      console.error('Failed to delete material:', error)
      toast.error('Failed to delete material')
    }
  }

  const filteredMaterials = materials.filter(material => {
    const matchesSearch = material.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (material.description?.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesType = typeFilter === 'all' || material.material_type === typeFilter
    const matchesSubject = subjectFilter === 'all' || material.subject_id === subjectFilter
    return matchesSearch && matchesType && matchesSubject && material.status === 'active'
  })

  // Sort materials
  const sortedMaterials = [...filteredMaterials].sort((a, b) => {
    if (sortBy === 'date') {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    }
    return a.title.localeCompare(b.title)
  })

  // Get subject name by ID
  const getSubjectName = (subjectId?: string) => {
    if (!subjectId) return 'N/A'
    const subject = subjects.find(s => s._id === subjectId)
    return subject?.name || 'Unknown'
  }

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileSelect(files[0])
    }
  }, [])

  const handleFileSelect = (file: File) => {
    // Determine file type from extension
    const ext = file.name.split('.').pop()?.toLowerCase()
    let materialType: Material['material_type'] = 'other'
    if (ext === 'pdf') materialType = 'pdf'
    else if (['doc', 'docx'].includes(ext || '')) materialType = 'doc'
    else if (['mp4', 'mov', 'avi', 'webm'].includes(ext || '')) materialType = 'video'
    else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) materialType = 'image'

    setFormData({
      ...formData,
      title: file.name,
      material_type: materialType,
      file_size: file.size,
      file_url: ''
    })
    setSelectedFile(file)
    setIsCreateDialogOpen(true)
    toast.info('File attached', {
      description: 'It will upload automatically when you create the material.',
    })
  }

  const handleBrowseClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFileSelect(files[0])
    }
  }

  return (
    <div className="space-y-6">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.mp4,.mov,.avi,.webm,.jpg,.jpeg,.png,.gif,.webp"
        onChange={handleFileInputChange}
      />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Learning Materials</h1>
          <p className="text-muted-foreground mt-1">
            Upload, organize, and share learning resources with your students.
          </p>
        </div>
        <Button
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload New
        </Button>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
        className={`
          border-2 border-dashed rounded-lg p-10 text-center cursor-pointer
          transition-all duration-200
          ${isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/50 bg-muted/30'
          }
        `}
      >
        <CloudUpload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-base font-medium text-foreground mb-1">
          Drag & drop files here, or click to browse
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          Supported file types: PDF, DOCX, PNG, JPG, etc.
        </p>
        <Button
          variant="outline"
          className="border-border"
          onClick={(e) => {
            e.stopPropagation()
            handleBrowseClick()
          }}
        >
          Browse Files
        </Button>
      </div>

      {/* Filters and Search */}
      <div className="bg-muted/30 border border-border rounded-lg p-4">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search materials..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-background border-border h-10"
              />
            </div>
          </div>

          {/* Filter by Subject */}
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-full md:w-[160px] h-10 border-border bg-background">
              <SelectValue placeholder="All Subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {subjects.map(subject => (
                <SelectItem key={subject._id} value={subject._id}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Filter by File Type */}
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full md:w-[150px] h-10 border-border bg-background">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="doc">Document</SelectItem>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="image">Image</SelectItem>
              <SelectItem value="link">Link</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={sortBy} onValueChange={(v: 'date' | 'name') => setSortBy(v)}>
            <SelectTrigger className="w-full md:w-[150px] h-10 border-border bg-background">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Sort by: Date</SelectItem>
              <SelectItem value="name">Sort by: Name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Materials Table */}
      {loading ? (
        /* Skeleton Loaders */
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>File Name</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Date Uploaded</TableHead>
                <TableHead>File Size</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="w-5 h-5 rounded" />
                      <Skeleton className="h-4 w-40" />
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 justify-end">
                      <Skeleton className="h-8 w-8 rounded" />
                      <Skeleton className="h-8 w-8 rounded" />
                      <Skeleton className="h-8 w-8 rounded" />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : sortedMaterials.length === 0 ? (
        <div className="border border-border rounded-lg bg-card p-12 text-center">
          <CloudUpload className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold text-foreground mb-2">
            No materials found
          </h3>
          <p className="text-muted-foreground mb-4">
            {searchTerm || typeFilter !== 'all' || subjectFilter !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Get started by uploading your first material'}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>File Name</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Date Uploaded</TableHead>
                <TableHead>File Size</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMaterials.map((material) => (
                <TableRow key={material._id} className="hover:bg-muted/30 transition-colors">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {getFileIcon(material.material_type)}
                      <span className="font-medium text-foreground">{material.title}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-foreground">
                    {getSubjectName(material.subject_id)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(material.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: '2-digit',
                      year: 'numeric'
                    })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatFileSize(material.file_size)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {material.shared_with_students ? 'All Students' : 'Specific'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => console.log('Edit:', material._id)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => console.log('Share:', material._id)}
                      >
                        <Share2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(material._id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Material Dialog */}
      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open)
          if (!open) {
            setSelectedFile(null)
            setIsUploadingFile(false)
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Material</DialogTitle>
            <DialogDescription>
              Add a new reference material for your students
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Algebra Basics Guide"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of the material"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="type">Material Type *</Label>
                <Select
                  value={formData.material_type}
                  onValueChange={(value: any) => setFormData({ ...formData, material_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF Document</SelectItem>
                    <SelectItem value="doc">Word Document</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                    <SelectItem value="link">External Link</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Select
                  value={formData.subject_id}
                  onValueChange={(value) => setFormData({ ...formData, subject_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map(subject => (
                      <SelectItem key={subject._id} value={subject._id}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="file_url">File URL *</Label>
              <Input
                id="file_url"
                value={formData.file_url}
                onChange={(e) => setFormData({ ...formData, file_url: e.target.value })}
                placeholder="https://..."
              />
              <p className="text-xs text-muted-foreground">
                Provide a file URL or attach a file using drag-and-drop above
              </p>
              {selectedFile && (
                <div className="rounded border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Attached file: <span className="font-medium text-foreground">{selectedFile.name}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="topic">Topic</Label>
              <Input
                id="topic"
                value={formData.topic}
                onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                placeholder="e.g., Linear Equations"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="e.g., algebra, basics, equations"
              />
            </div>

            <Button
              onClick={handleCreateMaterial}
              className="w-full bg-primary hover:bg-primary/90"
              disabled={!formData.title || (!formData.file_url && !selectedFile) || isUploadingFile}
            >
              {isUploadingFile ? 'Uploading file...' : 'Create Material'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

