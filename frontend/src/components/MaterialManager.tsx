import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/contexts/ToastContext'
import {
  Upload, Trash2, Edit, Share2, Folder, FileText, FileImage, FileVideo,
  File, Link, CloudUpload, Search, Plus, X, Check, Settings2, Pencil,
} from 'lucide-react'
import { API_BASE_URL } from '@/lib/config'

interface Material {
  _id: string
  title: string
  description?: string
  material_type: 'pdf' | 'doc' | 'video' | 'link' | 'image' | 'other'
  file_url?: string
  file_id?: string
  file_size?: number
  subject_id?: string
  topic?: string
  folder_id?: string | null
  folder_path?: string | null
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

interface MaterialFolder {
  _id: string
  name: string
  parent_id?: string | null
  path: string
}

const getFileIcon = (type: Material['material_type']) => {
  const cls = 'w-5 h-5'
  switch (type) {
    case 'pdf':   return <FileText className={`${cls} text-red-500`} />
    case 'doc':   return <FileText className={`${cls} text-blue-500`} />
    case 'video': return <FileVideo className={`${cls} text-purple-500`} />
    case 'image': return <FileImage className={`${cls} text-green-500`} />
    case 'link':  return <Link className={`${cls} text-cyan-500`} />
    default:      return <File className={`${cls} text-gray-500`} />
  }
}

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
  const [folders, setFolders] = useState<MaterialFolder[]>([])
  const [loading, setLoading] = useState(true)

  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [folderFilter, setFolderFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date')

  // Dialog open states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false)

  // Upload state
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploadingFile, setIsUploadingFile] = useState(false)

  // Edit state
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isTogglingShareId, setIsTogglingShareId] = useState<string | null>(null)
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null)

  // Folder modal state
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renamingFolderName, setRenamingFolderName] = useState('')
  const [isSavingRename, setIsSavingRename] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Upload / create form — minimal fields only
  const [formData, setFormData] = useState({
    title: '',
    material_type: 'pdf' as Material['material_type'],
    subject_id: '',
    folder_id: '',
    shared_with_students: true,
    file_id: '',
    file_size: 0,
  })

  // Edit form — retains all metadata fields
  const [editFormData, setEditFormData] = useState({
    title: '',
    description: '',
    material_type: 'pdf' as Material['material_type'],
    file_url: '',
    subject_id: '',
    folder_id: '',
    topic: '',
    tags: '',
    shared_with_students: true,
    file_size: 0,
  })

  useEffect(() => {
    fetchMaterials()
    fetchSubjects()
    fetchFolders()
  }, [])

  // ─── Data fetching ────────────────────────────────────────────────────────

  const fetchMaterials = async () => {
    try {
      setLoading(true)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setMaterials(data?.items || (Array.isArray(data) ? data : []))
      }
    } catch (err) {
      console.error('Failed to fetch materials:', err)
      toast.error('Failed to load materials')
    } finally {
      setLoading(false)
    }
  }

  const fetchSubjects = async () => {
    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/subjects/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setSubjects(await res.json())
    } catch (err) {
      console.error('Failed to fetch subjects:', err)
    }
  }

  const fetchFolders = async () => {
    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/folders?include_all=true`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setFolders(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Failed to fetch folders:', err)
    }
  }

  // ─── Material CRUD ────────────────────────────────────────────────────────

  const handleCreateMaterial = async () => {
    try {
      const token = await getToken()
      let resolvedFileUrl = ''
      let resolvedFileId = formData.file_id
      let resolvedFileSize = formData.file_size
      let resolvedType = formData.material_type

      if (selectedFile) {
        setIsUploadingFile(true)
        const uploadForm = new FormData()
        uploadForm.append('file', selectedFile)
        const uploadRes = await fetch(`${API_BASE_URL}/materials/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: uploadForm,
        })
        const uploadPayload = await uploadRes.json().catch(() => null)
        if (!uploadRes.ok) throw new Error(uploadPayload?.detail || 'Upload failed')
        resolvedFileUrl = String(uploadPayload?.file_url || '')
        resolvedFileId = String(uploadPayload?.file_id || '')
        resolvedFileSize = Number(uploadPayload?.file_size || selectedFile.size)
        resolvedType = uploadPayload?.material_type || resolvedType
      }

      if (!resolvedFileUrl) {
        toast.error('Please attach a file before uploading')
        return
      }

      const payload = {
        title: formData.title.trim(),
        description: null,
        material_type: resolvedType,
        file_url: resolvedFileUrl,
        file_id: resolvedFileId || null,
        file_size: resolvedFileSize,
        subject_id: formData.subject_id || null,
        folder_id: formData.folder_id || null,
        topic: null,
        tags: [],
        shared_with_students: formData.shared_with_students,
      }

      const res = await fetch(`${API_BASE_URL}/materials/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        toast.success('Material uploaded successfully')
        setIsCreateDialogOpen(false)
        setFormData({ title: '', material_type: 'pdf', subject_id: '', folder_id: '', shared_with_students: true, file_id: '', file_size: 0 })
        setSelectedFile(null)
        fetchMaterials()
      } else {
        toast.error('Failed to upload material')
      }
    } catch (err) {
      console.error('Failed to create material:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to upload material')
    } finally {
      setIsUploadingFile(false)
    }
  }

  const handleUpdateMaterial = async () => {
    if (!editingMaterial) return
    try {
      setIsSavingEdit(true)
      const token = await getToken()
      const payload = {
        title: editFormData.title.trim(),
        description: editFormData.description.trim() || null,
        material_type: editFormData.material_type,
        file_url: editFormData.file_url.trim() || null,
        file_size: editFormData.file_size || null,
        subject_id: editFormData.subject_id || null,
        folder_id: editFormData.folder_id || null,
        topic: editFormData.topic.trim() || null,
        tags: editFormData.tags.split(',').map((t) => t.trim()).filter(Boolean),
        shared_with_students: editFormData.shared_with_students,
      }
      const res = await fetch(`${API_BASE_URL}/materials/${editingMaterial._id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Failed to update material')
      toast.success('Material updated')
      setIsEditDialogOpen(false)
      setEditingMaterial(null)
      fetchMaterials()
    } catch (err) {
      console.error('Failed to update material:', err)
      toast.error('Failed to update material')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleDelete = async (materialId: string) => {
    if (!confirm('Delete this material?')) return
    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/${materialId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) { toast.success('Material deleted'); fetchMaterials() }
      else toast.error('Failed to delete material')
    } catch (err) {
      console.error('Failed to delete material:', err)
      toast.error('Failed to delete material')
    }
  }

  const handleToggleShare = async (material: Material) => {
    try {
      setIsTogglingShareId(material._id)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/${material._id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared_with_students: !material.shared_with_students }),
      })
      if (!res.ok) throw new Error('Failed to update')
      toast.success(material.shared_with_students ? 'Access restricted' : 'Shared with students')
      fetchMaterials()
    } catch {
      toast.error('Failed to update sharing settings')
    } finally {
      setIsTogglingShareId(null)
    }
  }

  // ─── Folder modal handlers (no window.prompt) ─────────────────────────────

  const handleCreateFolderInModal = async () => {
    const name = newFolderName.trim()
    if (!name) return
    try {
      setIsCreatingFolder(true)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/folders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: null }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to create folder')
      }
      toast.success('Folder created')
      setNewFolderName('')
      fetchFolders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create folder')
    } finally {
      setIsCreatingFolder(false)
    }
  }

  const handleStartRename = (folder: MaterialFolder) => {
    setRenamingFolderId(folder._id)
    setRenamingFolderName(folder.name)
  }

  const handleCancelRename = () => {
    setRenamingFolderId(null)
    setRenamingFolderName('')
  }

  const handleSaveRename = async () => {
    if (!renamingFolderId) return
    const name = renamingFolderName.trim()
    if (!name) return
    try {
      setIsSavingRename(true)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/folders/${renamingFolderId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to rename folder')
      }
      toast.success('Folder renamed')
      setRenamingFolderId(null)
      fetchFolders()
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename folder')
    } finally {
      setIsSavingRename(false)
    }
  }

  const handleDeleteFolderInModal = async (folder: MaterialFolder) => {
    if (!window.confirm(`Delete folder "${folder.name}"? Materials will move to the parent folder automatically.`)) return
    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/folders/${folder._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to delete folder')
      }
      toast.success('Folder deleted')
      if (folderFilter === folder._id) setFolderFilter('all')
      fetchFolders()
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete folder')
    }
  }

  // ─── File select / drag-drop ──────────────────────────────────────────────

  const handleFileSelect = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    let materialType: Material['material_type'] = 'other'
    if (ext === 'pdf') materialType = 'pdf'
    else if (['doc', 'docx'].includes(ext || '')) materialType = 'doc'
    else if (['mp4', 'mov', 'avi', 'webm'].includes(ext || '')) materialType = 'video'
    else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) materialType = 'image'
    setFormData({ ...formData, title: file.name, material_type: materialType, file_id: '', file_size: file.size })
    setSelectedFile(file)
    setIsCreateDialogOpen(true)
  }

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false) }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 0) handleFileSelect(files[0])
  }, [])

  const handleBrowseClick = () => fileInputRef.current?.click()
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFileSelect(e.target.files[0])
  }

  const openEditDialog = (material: Material) => {
    setEditingMaterial(material)
    setEditFormData({
      title: material.title,
      description: material.description || '',
      material_type: material.material_type,
      file_url: material.file_url || '',
      subject_id: material.subject_id || '',
      folder_id: material.folder_id || '',
      topic: material.topic || '',
      tags: material.tags.join(', '),
      shared_with_students: material.shared_with_students,
      file_size: material.file_size || 0,
    })
    setIsEditDialogOpen(true)
  }

  // ─── Filtering / sorting ──────────────────────────────────────────────────

  const selectedFolder = folders.find((f) => f._id === folderFilter)

  const filteredMaterials = materials.filter((m) => {
    const matchesSearch = m.title.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = typeFilter === 'all' || m.material_type === typeFilter
    const matchesSubject = subjectFilter === 'all' || m.subject_id === subjectFilter
    const matchesFolder =
      folderFilter === 'all'
        ? true
        : folderFilter === 'root'
          ? !m.folder_id
          : m.folder_id === folderFilter ||
            (selectedFolder?.path ? m.folder_path?.startsWith(`${selectedFolder.path}/`) : false)
    return matchesSearch && matchesType && matchesSubject && matchesFolder && m.status === 'active'
  })

  const sortedMaterials = [...filteredMaterials].sort((a, b) =>
    sortBy === 'date'
      ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      : a.title.localeCompare(b.title),
  )

  const getSubjectName = (id?: string) =>
    id ? (subjects.find((s) => s._id === id)?.name ?? 'Unknown') : '—'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
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
            Upload and organize learning resources for your students.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setIsFolderModalOpen(true)}>
            <Settings2 className="w-4 h-4 mr-2" />
            Manage Folders
          </Button>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Upload New
          </Button>
        </div>
      </div>

      {/* Current folder context */}
      {folderFilter !== 'all' && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
          Viewing folder:{' '}
          <span className="font-medium text-foreground">
            {folderFilter === 'root' ? 'Root materials' : (selectedFolder?.path ?? 'Selected folder')}
          </span>
        </div>
      )}

      {/* Drag & drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-all duration-200 ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/50 bg-muted/30'
        }`}
      >
        <CloudUpload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-base font-medium text-foreground mb-1">
          Drag & drop files here, or click to browse
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          Supported: PDF, DOCX, PNG, JPG, MP4, and more
        </p>
        <Button
          variant="outline"
          className="border-border"
          onClick={(e) => { e.stopPropagation(); handleBrowseClick() }}
        >
          Browse Files
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-muted/30 border border-border rounded-lg p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search materials..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-background border-border h-10"
            />
          </div>
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-full md:w-[160px] h-10 border-border bg-background">
              <SelectValue placeholder="All Subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {subjects.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={folderFilter} onValueChange={setFolderFilter}>
            <SelectTrigger className="w-full md:w-[200px] h-10 border-border bg-background">
              <SelectValue placeholder="All Folders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Folders</SelectItem>
              <SelectItem value="root">Root (No Folder)</SelectItem>
              {folders.map((f) => <SelectItem key={f._id} value={f._id}>{f.path}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full md:w-[140px] h-10 border-border bg-background">
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
          <Select value={sortBy} onValueChange={(v: 'date' | 'name') => setSortBy(v)}>
            <SelectTrigger className="w-full md:w-[140px] h-10 border-border bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Sort: Date</SelectItem>
              <SelectItem value="name">Sort: Name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Materials table */}
      {loading ? (
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>File Name</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Folder</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="flex items-center gap-3"><Skeleton className="w-5 h-5 rounded" /><Skeleton className="h-4 w-40" /></div></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><div className="flex items-center gap-2 justify-end"><Skeleton className="h-8 w-8" /><Skeleton className="h-8 w-8" /><Skeleton className="h-8 w-8" /></div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : sortedMaterials.length === 0 ? (
        <div className="border border-border rounded-lg bg-card p-12 text-center">
          <CloudUpload className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold text-foreground mb-2">No materials found</h3>
          <p className="text-muted-foreground">
            {searchTerm || typeFilter !== 'all' || subjectFilter !== 'all' || folderFilter !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Get started by dragging and dropping a file above'}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>File Name</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Folder</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Size</TableHead>
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
                  <TableCell className="text-foreground">{getSubjectName(material.subject_id)}</TableCell>
                  <TableCell className="text-muted-foreground">{material.folder_path ?? 'Root'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(material.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: '2-digit', year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatFileSize(material.file_size)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {material.shared_with_students ? 'All Students' : 'Private'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(material)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleToggleShare(material)} disabled={isTogglingShareId === material._id}>
                        <Share2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(material._id)}>
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

      {/* ── Folder Manager Dialog ─────────────────────────────────────────── */}
      <Dialog
        open={isFolderModalOpen}
        onOpenChange={(open) => {
          setIsFolderModalOpen(open)
          if (!open) { setNewFolderName(''); setRenamingFolderId(null); setRenamingFolderName('') }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Folders</DialogTitle>
            <DialogDescription>
              Create, rename, or delete folders to organize your materials.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Create new folder */}
            <div className="space-y-2">
              <Label>New Folder</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Folder name..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolderInModal() }}
                />
                <Button
                  onClick={handleCreateFolderInModal}
                  disabled={!newFolderName.trim() || isCreatingFolder}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {isCreatingFolder ? 'Adding...' : 'Add'}
                </Button>
              </div>
            </div>

            {/* Folder list */}
            <div className="space-y-2">
              <Label>
                Existing Folders{' '}
                {folders.length > 0 && (
                  <span className="text-muted-foreground font-normal">({folders.length})</span>
                )}
              </Label>
              {folders.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No folders yet. Create one above.
                </div>
              ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto rounded-lg border border-border p-1">
                  {folders.map((folder) => (
                    <div
                      key={folder._id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                    >
                      <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      {renamingFolderId === folder._id ? (
                        <>
                          <Input
                            className="h-7 flex-1 text-sm"
                            value={renamingFolderName}
                            onChange={(e) => setRenamingFolderName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename()
                              if (e.key === 'Escape') handleCancelRename()
                            }}
                            autoFocus
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-green-600 hover:text-green-700 flex-shrink-0"
                            onClick={handleSaveRename}
                            disabled={isSavingRename}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground flex-shrink-0"
                            onClick={handleCancelRename}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-foreground flex-1 truncate">{folder.path}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground flex-shrink-0"
                            onClick={() => handleStartRename(folder)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                            onClick={() => handleDeleteFolderInModal(folder)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Upload / Create Dialog ────────────────────────────────────────── */}
      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open)
          if (!open) { setSelectedFile(null); setIsUploadingFile(false) }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Material</DialogTitle>
            <DialogDescription>
              Choose a subject and folder to organize this file.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* File summary */}
            {selectedFile ? (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
                {getFileIcon(formData.material_type)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(selectedFile.size)} · {formData.material_type.toUpperCase()}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No file attached. Close this dialog and drag & drop a file onto the upload zone.
                </p>
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="upload-title">Title *</Label>
              <Input
                id="upload-title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Algebra Basics Guide"
              />
            </div>

            {/* Subject + Folder */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="upload-subject">
                  Subject <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Select
                  value={formData.subject_id || 'none'}
                  onValueChange={(v) => setFormData({ ...formData, subject_id: v === 'none' ? '' : v })}
                >
                  <SelectTrigger id="upload-subject"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {subjects.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="upload-folder">
                  Folder <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Select
                  value={formData.folder_id || 'none'}
                  onValueChange={(v) => setFormData({ ...formData, folder_id: v === 'none' ? '' : v })}
                >
                  <SelectTrigger id="upload-folder"><SelectValue placeholder="Root" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Root (no folder)</SelectItem>
                    {folders.map((f) => <SelectItem key={f._id} value={f._id}>{f.path}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={handleCreateMaterial}
              className="w-full"
              disabled={!formData.title.trim() || !selectedFile || isUploadingFile}
            >
              {isUploadingFile ? 'Uploading...' : 'Upload Material'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Material Dialog ──────────────────────────────────────────── */}
      <Dialog
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          setIsEditDialogOpen(open)
          if (!open) setEditingMaterial(null)
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Material</DialogTitle>
            <DialogDescription>Update details and sharing settings for this material.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title *</Label>
              <Input
                id="edit-title"
                value={editFormData.title}
                onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editFormData.description}
                onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-subject">Subject</Label>
                <Select
                  value={editFormData.subject_id || 'none'}
                  onValueChange={(v) => setEditFormData({ ...editFormData, subject_id: v === 'none' ? '' : v })}
                >
                  <SelectTrigger id="edit-subject"><SelectValue placeholder="Select subject" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No subject</SelectItem>
                    {subjects.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-folder">Folder</Label>
                <Select
                  value={editFormData.folder_id || 'none'}
                  onValueChange={(v) => setEditFormData({ ...editFormData, folder_id: v === 'none' ? '' : v })}
                >
                  <SelectTrigger id="edit-folder"><SelectValue placeholder="Select folder" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Root (no folder)</SelectItem>
                    {folders.map((f) => <SelectItem key={f._id} value={f._id}>{f.path}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-topic">Topic</Label>
                <Input
                  id="edit-topic"
                  value={editFormData.topic}
                  onChange={(e) => setEditFormData({ ...editFormData, topic: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-tags">Tags (comma-separated)</Label>
                <Input
                  id="edit-tags"
                  value={editFormData.tags}
                  onChange={(e) => setEditFormData({ ...editFormData, tags: e.target.value })}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 bg-muted/30 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Student Access</p>
                <p className="text-xs text-muted-foreground">
                  {editFormData.shared_with_students ? 'Visible to students' : 'Hidden from students'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditFormData({ ...editFormData, shared_with_students: !editFormData.shared_with_students })}
              >
                {editFormData.shared_with_students ? 'Set Private' : 'Share with Students'}
              </Button>
            </div>

            <Button
              onClick={handleUpdateMaterial}
              className="w-full"
              disabled={!editFormData.title.trim() || isSavingEdit}
            >
              {isSavingEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
