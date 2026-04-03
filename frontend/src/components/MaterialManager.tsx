import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { FolderCard } from '@/components/ui/folder'
import { FileUploadCard } from '@/components/ui/file-upload-card'
import type { UploadedFile } from '@/components/ui/file-upload-card'
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal'
import { toast } from '@/contexts/ToastContext'
import {
  Upload, Trash2, Edit, Share2, FileText, FileImage, FileVideo,
  File, Link, Search, FolderPlus, FolderInput, MoreVertical,
  Pencil, ChevronRight, ChevronDown, Folder, Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { API_BASE_URL } from '@/lib/config'
import { useSubjects } from '@/hooks/useQueries'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Material {
  _id: string
  title: string
  description?: string
  material_type: 'pdf' | 'doc' | 'video' | 'link' | 'image' | 'other'
  file_url?: string
  file_id?: string
  file_size?: number
  subject_id?: string
  folder_id?: string | null
  folder_path?: string | null
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

interface MaterialFolder {
  _id: string
  name: string
  parent_id: string | null
  path: string
  created_at: string
  updated_at: string
}

interface BreadcrumbSegment {
  id: string
  name: string
}

interface BulkMaterialActionResponse {
  requested_count?: number
  updated_count?: number
  updated_material_ids?: string[]
  skipped_count?: number
  skipped_material_ids?: string[]
}

interface MaterialFormState {
  title: string
  description: string
  material_type: Material['material_type']
  file_url: string
  subject_id: string
  topic: string
  tags: string
  shared_with_students: boolean
  file_size: number
}

const createEmptyMaterialForm = (): MaterialFormState => ({
  title: '',
  description: '',
  material_type: 'link',
  file_url: '',
  subject_id: '',
  topic: '',
  tags: '',
  shared_with_students: true,
  file_size: 0,
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getFileIcon = (type: Material['material_type']) => {
  const cls = 'w-5 h-5'
  switch (type) {
    case 'pdf':   return <FileText className={`${cls} text-red-500`} />
    case 'doc':   return <FileText className={`${cls} text-blue-500`} />
    case 'video': return <FileVideo className={`${cls} text-purple-500`} />
    case 'image': return <FileImage className={`${cls} text-green-500`} />
    case 'link':  return <Link className={`${cls} text-cyan-500`} />
    default:      return <File className={`${cls} text-muted-foreground`} />
  }
}

const formatFileSize = (bytes?: number) => {
  if (!bytes) return 'N/A'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const inferMaterialType = (fileName: string): Material['material_type'] => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext || '')) return 'doc'
  if (['mp4', 'mov', 'avi', 'webm'].includes(ext || '')) return 'video'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return 'image'
  return 'other'
}

// ─── Folder Tree Picker (for Move dialog) ─────────────────────────────────────

function FolderTreePicker({
  folders,
  excludeIds,
  selectedId,
  onSelect,
}: {
  folders: MaterialFolder[]
  excludeIds: Set<string>
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const childrenMap = useMemo(() => {
    const map = new Map<string | null, MaterialFolder[]>()
    for (const f of folders) {
      const key = f.parent_id || null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(f)
    }
    return map
  }, [folders])

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderNode = (folder: MaterialFolder, depth: number): React.ReactNode => {
    const children = childrenMap.get(folder._id) || []
    const hasChildren = children.length > 0
    const isExpanded = expanded.has(folder._id)
    const isExcluded = excludeIds.has(folder._id)
    const isSelected = selectedId === folder._id

    return (
      <div key={folder._id}>
        <button
          type="button"
          disabled={isExcluded}
          onClick={() => !isExcluded && onSelect(folder._id)}
          className={cn(
            'flex items-center gap-1.5 w-full px-2 py-1.5 text-sm rounded-md transition-colors text-left',
            isExcluded && 'opacity-40 cursor-not-allowed',
            isSelected && !isExcluded && 'bg-primary/10 text-primary',
            !isSelected && !isExcluded && 'hover:bg-muted',
          )}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          {hasChildren ? (
            <span
              className="flex-shrink-0 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); toggle(folder._id) }}
            >
              {isExpanded
                ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </span>
          ) : (
            <span className="w-4 flex-shrink-0" />
          )}
          <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="truncate">{folder.name}</span>
        </button>
        {hasChildren && isExpanded && children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  const rootFolders = childrenMap.get(null) || []

  return (
    <div className="border border-border rounded-lg max-h-64 overflow-y-auto p-1">
      {/* Root option */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'flex items-center gap-1.5 w-full px-2 py-1.5 text-sm rounded-md transition-colors text-left',
          selectedId === null ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
        )}
      >
        <span className="w-4 flex-shrink-0" />
        <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="font-medium">Root (top level)</span>
      </button>
      {rootFolders.map((f) => renderNode(f, 1))}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MaterialManager() {
  const { getToken } = useAuth()

  // Core data
  const [materials, setMaterials] = useState<Material[]>([])
  const { data: subjectsData } = useSubjects()
  const subjects = useMemo<Subject[]>(() => {
    if (Array.isArray(subjectsData)) {
      return subjectsData as Subject[]
    }

    return ((subjectsData as { items?: Subject[] } | undefined)?.items || []) as Subject[]
  }, [subjectsData])
  const [folders, setFolders] = useState<MaterialFolder[]>([])
  const [allFolders, setAllFolders] = useState<MaterialFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [foldersLoading, setFoldersLoading] = useState(true)
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set())

  // Folder navigation
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [breadcrumbTrail, setBreadcrumbTrail] = useState<BreadcrumbSegment[]>([])

  // Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date')

  // Upload modal
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<UploadedFile[]>([])
  const [uploadSubjectId, setUploadSubjectId] = useState<string | null>(null)
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(null)

  // Manual create dialog
  const [isCreateMaterialOpen, setIsCreateMaterialOpen] = useState(false)
  const [isCreatingMaterial, setIsCreatingMaterial] = useState(false)
  const [createFormData, setCreateFormData] = useState<MaterialFormState>(createEmptyMaterialForm)

  // Edit dialog
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isTogglingShareId, setIsTogglingShareId] = useState<string | null>(null)
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null)
  const [editFormData, setEditFormData] = useState<MaterialFormState>(createEmptyMaterialForm)

  // Create folder dialog
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(null)

  // Rename folder dialog
  const [isRenameFolderOpen, setIsRenameFolderOpen] = useState(false)
  const [renamingFolder, setRenamingFolder] = useState<MaterialFolder | null>(null)
  const [renameFolderName, setRenameFolderName] = useState('')
  const [isRenamingFolder, setIsRenamingFolder] = useState(false)

  // Move dialog (shared for folders + files)
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<{ type: 'folder' | 'file'; id: string; name: string } | null>(null)
  const [selectedDestination, setSelectedDestination] = useState<string | null>(null)
  const [isMoving, setIsMoving] = useState(false)
  const [isBulkMoveDialogOpen, setIsBulkMoveDialogOpen] = useState(false)
  const [bulkMoveDestination, setBulkMoveDestination] = useState<string | null>(null)
  const [isBulkMoving, setIsBulkMoving] = useState(false)

  // Delete confirmation
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'folder' | 'file'; id: string; name: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [isBulkSharing, setIsBulkSharing] = useState(false)

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const fetchMaterials = async () => {
    try {
      setLoading(true)
      const token = await getToken()
      const collectedMaterials: Material[] = []
      let page = 1
      let hasNext = true

      while (hasNext) {
        const res = await fetch(`${API_BASE_URL}/materials/?page=${page}&per_page=100&status=active`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          throw new Error(payload?.detail || 'Failed to load materials')
        }

        const data = await res.json()
        const pageItems = data?.items || (Array.isArray(data) ? data : [])
        collectedMaterials.push(...pageItems)
        hasNext = Boolean(data?.meta?.has_next)
        page += 1
      }

      setMaterials(collectedMaterials)
    } catch (err) {
      console.error('Failed to fetch materials:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to load materials')
    } finally {
      setLoading(false)
    }
  }

const fetchFoldersForParent = async (parentId: string | null) => {
    try {
      setFoldersLoading(true)
      const token = await getToken()
      const url = parentId
        ? `${API_BASE_URL}/materials/folders?parent_id=${parentId}`
        : `${API_BASE_URL}/materials/folders`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setFolders(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Failed to fetch folders:', err)
    } finally {
      setFoldersLoading(false)
    }
  }

  const fetchAllFolders = async () => {
    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/folders?include_all=true`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setAllFolders(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Failed to fetch all folders:', err)
    }
  }

  useEffect(() => {
    fetchMaterials()
  }, [])

  useEffect(() => {
    fetchFoldersForParent(currentFolderId)
  }, [currentFolderId])

  useEffect(() => {
    setSelectedMaterialIds(new Set())
  }, [currentFolderId])

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const navigateToFolder = (folder: MaterialFolder) => {
    setBreadcrumbTrail((prev) => [...prev, { id: folder._id, name: folder.name }])
    setCurrentFolderId(folder._id)
    setSearchTerm('')
    setTypeFilter('all')
  }

  const navigateToRoot = () => {
    setBreadcrumbTrail([])
    setCurrentFolderId(null)
    setSearchTerm('')
    setTypeFilter('all')
  }

  const navigateToBreadcrumb = (index: number) => {
    if (index === -1) {
      navigateToRoot()
    } else {
      const segment = breadcrumbTrail[index]
      setBreadcrumbTrail(breadcrumbTrail.slice(0, index + 1))
      setCurrentFolderId(segment.id)
    }
  }

  const currentFolderName = breadcrumbTrail.length > 0
    ? breadcrumbTrail[breadcrumbTrail.length - 1].name
    : null

  // ─── Derived data ───────────────────────────────────────────────────────────

  const folderFileCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    materials.forEach((m) => {
      if (m.folder_id && m.status === 'active') {
        counts[m.folder_id] = (counts[m.folder_id] || 0) + 1
      }
    })
    return counts
  }, [materials])

  const currentFolderMaterials = useMemo(() => {
    return materials.filter((m) => {
      if (m.status !== 'active') return false
      if (currentFolderId === null) return !m.folder_id
      return m.folder_id === currentFolderId
    })
  }, [materials, currentFolderId])

  const filteredMaterials = useMemo(() => {
    return currentFolderMaterials.filter((m) => {
      const matchesSearch = m.title.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesType = typeFilter === 'all' || m.material_type === typeFilter
      return matchesSearch && matchesType
    })
  }, [currentFolderMaterials, searchTerm, typeFilter])

  const sortedMaterials = useMemo(() => {
    return [...filteredMaterials].sort((a, b) =>
      sortBy === 'date'
        ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        : a.title.localeCompare(b.title),
    )
  }, [filteredMaterials, sortBy])

  const allVisibleMaterialsSelected =
    sortedMaterials.length > 0 && sortedMaterials.every((material) => selectedMaterialIds.has(material._id))
  const someVisibleMaterialsSelected =
    sortedMaterials.some((material) => selectedMaterialIds.has(material._id)) && !allVisibleMaterialsSelected

  // ─── Folder CRUD ────────────────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    try {
      setIsCreatingFolder(true)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/folders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: createFolderParentId }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to create folder')
      }
      toast.success('Folder created')
      setIsCreateFolderOpen(false)
      setNewFolderName('')
      fetchFoldersForParent(currentFolderId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create folder')
    } finally {
      setIsCreatingFolder(false)
    }
  }

  const handleRenameFolder = async () => {
    if (!renamingFolder) return
    const name = renameFolderName.trim()
    if (!name) return
    try {
      setIsRenamingFolder(true)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/folders/${renamingFolder._id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to rename folder')
      }
      toast.success('Folder renamed')
      setIsRenameFolderOpen(false)
      setRenamingFolder(null)
      fetchFoldersForParent(currentFolderId)
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename folder')
    } finally {
      setIsRenamingFolder(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setIsDeleting(true)
      const token = await getToken()
      const url = deleteTarget.type === 'folder'
        ? `${API_BASE_URL}/materials/folders/${deleteTarget.id}`
        : `${API_BASE_URL}/materials/${deleteTarget.id}`
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Failed to delete ${deleteTarget.type}`)
      toast.success(`${deleteTarget.type === 'folder' ? 'Folder' : 'Material'} deleted`)
      setIsDeleteDialogOpen(false)
      setDeleteTarget(null)
      if (deleteTarget.type === 'file') {
        setSelectedMaterialIds((prev) => {
          const next = new Set(prev)
          next.delete(deleteTarget.id)
          return next
        })
      }
      if (deleteTarget.type === 'folder') fetchFoldersForParent(currentFolderId)
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleMove = async () => {
    if (!moveTarget) return
    try {
      setIsMoving(true)
      const token = await getToken()
      let res: Response
      if (moveTarget.type === 'folder') {
        res = await fetch(`${API_BASE_URL}/materials/folders/${moveTarget.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ parent_id: selectedDestination }),
        })
      } else {
        res = await fetch(`${API_BASE_URL}/materials/${moveTarget.id}/move`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_id: selectedDestination }),
        })
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to move')
      }
      toast.success(`${moveTarget.type === 'folder' ? 'Folder' : 'File'} moved`)
      setIsMoveDialogOpen(false)
      setMoveTarget(null)
      fetchFoldersForParent(currentFolderId)
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Move failed')
    } finally {
      setIsMoving(false)
    }
  }

  // ─── Dialog openers ─────────────────────────────────────────────────────────

  const openRenameDialog = (folder: MaterialFolder) => {
    setRenamingFolder(folder)
    setRenameFolderName(folder.name)
    setIsRenameFolderOpen(true)
  }

  const openMoveDialog = (type: 'folder' | 'file', item: { _id: string; name?: string; title?: string }) => {
    setMoveTarget({ type, id: item._id, name: (item.name || item.title)! })
    setSelectedDestination(null)
    fetchAllFolders()
    setIsMoveDialogOpen(true)
  }

  const openDeleteDialog = (type: 'folder' | 'file', item: { _id: string; name?: string; title?: string }) => {
    setDeleteTarget({ type, id: item._id, name: (item.name || item.title)! })
    setIsDeleteDialogOpen(true)
  }

  const handleToggleSelectMaterial = (materialId: string) => {
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev)
      if (next.has(materialId)) {
        next.delete(materialId)
      } else {
        next.add(materialId)
      }
      return next
    })
  }

  const handleSelectAllVisibleMaterials = () => {
    const visibleIds = sortedMaterials.map((material) => material._id)
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev)
      if (visibleIds.every((id) => next.has(id))) {
        visibleIds.forEach((id) => next.delete(id))
      } else {
        visibleIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const handleDeselectAllMaterials = () => {
    setSelectedMaterialIds(new Set())
  }

  const openCreateMaterialDialog = () => {
    setCreateFormData(createEmptyMaterialForm())
    setIsCreateMaterialOpen(true)
  }

  const handleCreateMaterial = async () => {
    if (!createFormData.title.trim()) {
      toast.error('Material title is required')
      return
    }

    if (createFormData.material_type === 'link' && !createFormData.file_url.trim()) {
      toast.error('Link URL is required for link materials')
      return
    }

    try {
      setIsCreatingMaterial(true)
      const token = await getToken()
      const payload = {
        title: createFormData.title.trim(),
        description: createFormData.description.trim() || null,
        material_type: createFormData.material_type,
        file_url: createFormData.file_url.trim() || null,
        file_size: createFormData.file_size || null,
        subject_id: createFormData.subject_id || null,
        folder_id: currentFolderId,
        topic: createFormData.topic.trim() || null,
        tags: createFormData.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        shared_with_students: createFormData.shared_with_students,
      }

      const res = await fetch(`${API_BASE_URL}/materials/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to create material')
      }

      toast.success('Material created')
      setIsCreateMaterialOpen(false)
      setCreateFormData(createEmptyMaterialForm())
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create material')
    } finally {
      setIsCreatingMaterial(false)
    }
  }

  const openBulkMoveDialog = () => {
    setBulkMoveDestination(currentFolderId)
    fetchAllFolders()
    setIsBulkMoveDialogOpen(true)
  }

  const handleBulkMove = async () => {
    if (selectedMaterialIds.size === 0) {
      return
    }

    try {
      setIsBulkMoving(true)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/bulk-move`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          material_ids: [...selectedMaterialIds],
          folder_id: bulkMoveDestination,
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to move selected materials')
      }

      const result = await res.json() as BulkMaterialActionResponse
      toast.success('Bulk move completed', {
        description: `${result.updated_count || 0} moved${result.skipped_count ? `, ${result.skipped_count} skipped` : ''}`,
      })
      setIsBulkMoveDialogOpen(false)
      setSelectedMaterialIds(new Set())
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move selected materials')
    } finally {
      setIsBulkMoving(false)
    }
  }

  const handleBulkShare = async (sharedWithStudents: boolean) => {
    if (selectedMaterialIds.size === 0) {
      return
    }

    try {
      setIsBulkSharing(true)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/bulk-share`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          material_ids: [...selectedMaterialIds],
          shared_with_students: sharedWithStudents,
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to update sharing')
      }

      const result = await res.json() as BulkMaterialActionResponse
      toast.success(sharedWithStudents ? 'Materials shared with students' : 'Materials made private', {
        description: `${result.updated_count || 0} updated${result.skipped_count ? `, ${result.skipped_count} skipped` : ''}`,
      })
      setSelectedMaterialIds(new Set())
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update sharing settings')
    } finally {
      setIsBulkSharing(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedMaterialIds.size === 0) {
      return
    }

    try {
      setIsBulkDeleting(true)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/bulk-delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ material_ids: [...selectedMaterialIds] }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to delete selected materials')
      }

      const result = await res.json() as BulkMaterialActionResponse
      toast.success('Bulk delete completed', {
        description: `${result.updated_count || 0} archived${result.skipped_count ? `, ${result.skipped_count} skipped` : ''}`,
      })
      setIsBulkDeleteDialogOpen(false)
      setSelectedMaterialIds(new Set())
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete selected materials')
    } finally {
      setIsBulkDeleting(false)
    }
  }

  // ─── Upload logic ───────────────────────────────────────────────────────────

  const handleFilesAdded = useCallback(async (newFiles: File[]) => {
    const token = await getToken()

    for (const file of newFiles) {
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const entry: UploadedFile = {
        id,
        name: file.name,
        size: file.size,
        status: 'uploading',
        progress: 0,
        file,
      }

      setUploadFiles((prev) => [...prev, entry])

      try {
        const uploadForm = new FormData()
        uploadForm.append('file', file)

        const uploadResult = await new Promise<{
          file_url: string
          file_id: string
          file_size: number
          material_type?: string
        }>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', `${API_BASE_URL}/materials/upload`)
          xhr.setRequestHeader('Authorization', `Bearer ${token}`)

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 80)
              setUploadFiles((prev) =>
                prev.map((f) => (f.id === id ? { ...f, progress: pct } : f)),
              )
            }
          }

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(JSON.parse(xhr.responseText))
            } else {
              reject(new Error('Upload failed'))
            }
          }
          xhr.onerror = () => reject(new Error('Upload failed'))
          xhr.send(uploadForm)
        })

        const materialType = uploadResult.material_type || inferMaterialType(file.name)
        const payload = {
          title: file.name,
          description: null,
          material_type: materialType,
          file_url: uploadResult.file_url,
          file_id: uploadResult.file_id || null,
          file_size: uploadResult.file_size || file.size,
          subject_id: uploadSubjectId || null,
          folder_id: uploadFolderId || null,
          topic: null,
          tags: [],
          shared_with_students: true,
        }

        const res = await fetch(`${API_BASE_URL}/materials/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!res.ok) throw new Error('Failed to create material record')

        setUploadFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: 'completed', progress: 100 } : f)),
        )
      } catch (err) {
        console.error('Upload error:', err)
        setUploadFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: 'error' } : f)),
        )
      }
    }

    fetchMaterials()
  }, [uploadFolderId, uploadSubjectId, getToken])

  const handleRemoveUploadFile = useCallback((id: string) => {
    setUploadFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const openUploadModal = () => {
    setUploadSubjectId(null)
    setUploadFiles([])
    setUploadFolderId(currentFolderId)
    fetchAllFolders()
    setIsUploadModalOpen(true)
  }

  // ─── Material CRUD ──────────────────────────────────────────────────────────

  const handleUpdateMaterial = async () => {
    if (!editingMaterial) return
    if (!editFormData.title.trim()) {
      toast.error('Material title is required')
      return
    }
    if (editFormData.material_type === 'link' && !editFormData.file_url.trim()) {
      toast.error('Link URL is required for link materials')
      return
    }
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
        topic: editFormData.topic.trim() || null,
        tags: editFormData.tags.split(',').map((t) => t.trim()).filter(Boolean),
        shared_with_students: editFormData.shared_with_students,
      }
      const res = await fetch(`${API_BASE_URL}/materials/${editingMaterial._id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to update material')
      }
      toast.success('Material updated')
      setIsEditDialogOpen(false)
      setEditingMaterial(null)
      fetchMaterials()
    } catch (err) {
      console.error('Failed to update material:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to update material')
    } finally {
      setIsSavingEdit(false)
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

  const openEditDialog = (material: Material) => {
    setEditingMaterial(material)
    setEditFormData({
      title: material.title,
      description: material.description || '',
      material_type: material.material_type,
      file_url: material.file_url || '',
      subject_id: material.subject_id || '',
      topic: material.topic || '',
      tags: material.tags.join(', '),
      shared_with_students: material.shared_with_students,
      file_size: material.file_size || 0,
    })
    setIsEditDialogOpen(true)
  }

  // Move dialog: compute excluded folder IDs
  const moveExcludeIds = useMemo(() => {
    const ids = new Set<string>()
    if (moveTarget?.type === 'folder') {
      ids.add(moveTarget.id)
      // Also exclude all descendants
      const targetFolder = allFolders.find((f) => f._id === moveTarget.id)
      if (targetFolder) {
        const prefix = targetFolder.path + '/'
        allFolders.forEach((f) => {
          if (f.path.startsWith(prefix)) ids.add(f._id)
        })
      }
    }
    return ids
  }, [moveTarget, allFolders])

  // ─── Render ─────────────────────────────────────────────────────────────────

  const hasContent = folders.length > 0 || currentFolderMaterials.length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {breadcrumbTrail.length > 0 ? (
            <div>
              <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                <button
                  type="button"
                  className="hover:text-foreground transition-colors"
                  onClick={navigateToRoot}
                >
                  Materials
                </button>
                {breadcrumbTrail.map((seg, i) => (
                  <span key={seg.id} className="flex items-center gap-1">
                    <span>/</span>
                    {i === breadcrumbTrail.length - 1 ? (
                      <span className="text-foreground font-medium">{seg.name}</span>
                    ) : (
                      <button
                        type="button"
                        className="hover:text-foreground transition-colors"
                        onClick={() => navigateToBreadcrumb(i)}
                      >
                        {seg.name}
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <h1 className="text-3xl font-bold text-foreground">{currentFolderName}</h1>
            </div>
          ) : (
            <div>
              <h1 className="text-3xl font-bold text-foreground">Learning Materials</h1>
              <p className="text-muted-foreground mt-1">
                Upload and organize learning resources for your students.
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setNewFolderName(''); setCreateFolderParentId(currentFolderId); fetchAllFolders(); setIsCreateFolderOpen(true) }}>
            <FolderPlus className="w-4 h-4 mr-2" />
            New Folder
          </Button>
          <Button variant="outline" onClick={openCreateMaterialDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Add Material
          </Button>
          <Button onClick={openUploadModal}>
            <Upload className="w-4 h-4 mr-2" />
            Upload New
          </Button>
        </div>
      </div>

      {/* ─── Folder grid ──────────────────────────────────────────────── */}
      {foldersLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="w-48 h-32 rounded-xl" />
          ))}
        </div>
      ) : folders.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 pt-2">
          {folders.map((folder) => (
            <div key={folder._id} className="relative group w-fit">
              <FolderCard
                name={folder.name}
                count={folderFileCounts[folder._id] || 0}
                onClick={() => navigateToFolder(folder)}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity z-10 bg-white/80 hover:bg-white shadow-sm rounded-full"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openRenameDialog(folder)}>
                    <Pencil className="w-4 h-4 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openMoveDialog('folder', folder)}>
                    <FolderInput className="w-4 h-4 mr-2" />
                    Move
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => openDeleteDialog('folder', folder)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {/* ─── Files section ────────────────────────────────────────────── */}
      {/* Filters (show when there are materials or search is active) */}
      {(currentFolderMaterials.length > 0 || searchTerm || typeFilter !== 'all') && (
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
      )}

      {/* Table */}
      {loading ? (
        <div className="border border-border rounded-lg overflow-hidden bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-12">
                    <Checkbox
                      checked={allVisibleMaterialsSelected ? true : someVisibleMaterialsSelected ? 'indeterminate' : false}
                      onCheckedChange={handleSelectAllVisibleMaterials}
                      aria-label="Select all visible materials"
                    />
                  </TableHead>
                  <TableHead>File Name</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell><div className="flex items-center gap-3"><Skeleton className="w-5 h-5 rounded" /><Skeleton className="h-4 w-40" /></div></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><div className="flex items-center gap-2 justify-end"><Skeleton className="h-8 w-8" /><Skeleton className="h-8 w-8" /><Skeleton className="h-8 w-8" /><Skeleton className="h-8 w-8" /></div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : sortedMaterials.length > 0 ? (
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-12">
                  <Checkbox
                    checked={allVisibleMaterialsSelected ? true : someVisibleMaterialsSelected ? 'indeterminate' : false}
                    onCheckedChange={handleSelectAllVisibleMaterials}
                    aria-label="Select all visible materials"
                  />
                </TableHead>
                <TableHead>File Name</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMaterials.map((material) => (
                <TableRow key={material._id} className={cn('hover:bg-muted/30 transition-colors', selectedMaterialIds.has(material._id) && 'bg-primary/5')}>
                  <TableCell>
                    <Checkbox
                      checked={selectedMaterialIds.has(material._id)}
                      onCheckedChange={() => handleToggleSelectMaterial(material._id)}
                      aria-label={`Select ${material.title}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {getFileIcon(material.material_type)}
                      <span className="font-medium text-foreground">{material.title}</span>
                    </div>
                  </TableCell>
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
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openMoveDialog('file', material)} title="Move to folder">
                        <FolderInput className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => openDeleteDialog('file', material)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : !foldersLoading && !hasContent ? (
        <div className="border border-border rounded-lg bg-card p-12 text-center">
          <Folder className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold text-foreground mb-2">
            {currentFolderId ? 'This folder is empty' : 'No materials yet'}
          </h3>
          <p className="text-muted-foreground">
            {currentFolderId
              ? 'Upload files or create subfolders to organize your materials.'
              : 'Create a folder or upload files to get started.'}
          </p>
        </div>
      ) : null}

      {selectedMaterialIds.size > 0 && (
        <div className="sticky bottom-0 z-40 pt-2">
          <div className="bg-card border border-border rounded-lg shadow-lg p-4 flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              {selectedMaterialIds.size} material{selectedMaterialIds.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleDeselectAllMaterials}>
                Deselect All
              </Button>
              <Button variant="outline" size="sm" onClick={openBulkMoveDialog}>
                <FolderInput className="w-4 h-4 mr-1" />
                Move
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBulkShare(true)} disabled={isBulkSharing}>
                <Share2 className="w-4 h-4 mr-1" />
                Share
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBulkShare(false)} disabled={isBulkSharing}>
                <Share2 className="w-4 h-4 mr-1" />
                Make Private
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setIsBulkDeleteDialogOpen(true)}>
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Folder Dialog ──────────────────────────────────────── */}
      <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>
              Choose a name and location for the new folder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-folder-name">Folder name</Label>
              <Input
                id="new-folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder() }}
                placeholder="e.g., Chapter 1"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Parent folder</Label>
              <FolderTreePicker
                folders={allFolders}
                excludeIds={new Set()}
                selectedId={createFolderParentId}
                onSelect={setCreateFolderParentId}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateFolderOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateFolder} disabled={!newFolderName.trim() || isCreatingFolder}>
                {isCreatingFolder ? 'Creating...' : 'Create Folder'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Rename Folder Dialog ──────────────────────────────────────── */}
      <Dialog open={isRenameFolderOpen} onOpenChange={(open) => { setIsRenameFolderOpen(open); if (!open) setRenamingFolder(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>Enter a new name for this folder.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="rename-folder">New name</Label>
              <Input
                id="rename-folder"
                value={renameFolderName}
                onChange={(e) => setRenameFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder() }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsRenameFolderOpen(false)}>Cancel</Button>
              <Button onClick={handleRenameFolder} disabled={!renameFolderName.trim() || isRenamingFolder}>
                {isRenamingFolder ? 'Renaming...' : 'Rename'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Move Dialog ───────────────────────────────────────────────── */}
      <Dialog open={isMoveDialogOpen} onOpenChange={(open) => { setIsMoveDialogOpen(open); if (!open) setMoveTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move {moveTarget?.type === 'folder' ? 'Folder' : 'File'}</DialogTitle>
            <DialogDescription>
              Select a destination for &ldquo;{moveTarget?.name}&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FolderTreePicker
              folders={allFolders}
              excludeIds={moveExcludeIds}
              selectedId={selectedDestination}
              onSelect={setSelectedDestination}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsMoveDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleMove} disabled={isMoving}>
                {isMoving ? 'Moving...' : 'Move Here'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ───────────────────────────────────────── */}
      <ConfirmDeleteModal
        open={isDeleteDialogOpen}
        onOpenChange={(open) => { setIsDeleteDialogOpen(open); if (!open) setDeleteTarget(null) }}
        onConfirm={handleDelete}
        itemName={deleteTarget?.name}
        description={
          deleteTarget?.type === 'folder'
            ? `The folder "${deleteTarget.name}" will be deleted. Files inside will be moved to the parent folder.`
            : undefined
        }
        loading={isDeleting}
      />

      {/* ── Upload Modal ──────────────────────────────────────────────── */}
      <Dialog
        open={isUploadModalOpen}
        onOpenChange={(open) => {
          setIsUploadModalOpen(open)
          if (!open) { setUploadFiles([]); setUploadSubjectId(null) }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Materials</DialogTitle>
            <DialogDescription>
              Choose a location and drag & drop files to upload.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Location picker */}
            <div className="space-y-2">
              <Label>Location</Label>
              <FolderTreePicker
                folders={allFolders}
                excludeIds={new Set()}
                selectedId={uploadFolderId}
                onSelect={setUploadFolderId}
              />
            </div>

            {/* Optional subject picker */}
            <div className="space-y-2">
              <Label>Subject <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select
                value={uploadSubjectId || 'none'}
                onValueChange={(v) => setUploadSubjectId(v === 'none' ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <FileUploadCard
              files={uploadFiles}
              onFilesAdded={handleFilesAdded}
              onRemoveFile={handleRemoveUploadFile}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCreateMaterialOpen}
        onOpenChange={(open) => {
          setIsCreateMaterialOpen(open)
          if (!open) setCreateFormData(createEmptyMaterialForm())
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Material</DialogTitle>
            <DialogDescription>
              Create a link or external resource record for the current folder.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-material-title">Title *</Label>
              <Input
                id="create-material-title"
                value={createFormData.title}
                onChange={(e) => setCreateFormData({ ...createFormData, title: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-material-description">Description</Label>
              <Textarea
                id="create-material-description"
                value={createFormData.description}
                onChange={(e) => setCreateFormData({ ...createFormData, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="create-material-type">Material Type *</Label>
                <Select
                  value={createFormData.material_type}
                  onValueChange={(value: Material['material_type']) => setCreateFormData({ ...createFormData, material_type: value })}
                >
                  <SelectTrigger id="create-material-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="doc">Document</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                    <SelectItem value="link">Link</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="create-material-url">
                  {createFormData.material_type === 'link' ? 'Link URL *' : 'External URL'}
                </Label>
                <Input
                  id="create-material-url"
                  value={createFormData.file_url}
                  onChange={(e) => setCreateFormData({ ...createFormData, file_url: e.target.value })}
                  placeholder="https://example.com/resource"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="create-material-subject">Subject</Label>
                <Select
                  value={createFormData.subject_id || 'none'}
                  onValueChange={(value) => setCreateFormData({ ...createFormData, subject_id: value === 'none' ? '' : value })}
                >
                  <SelectTrigger id="create-material-subject"><SelectValue placeholder="Select subject" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {subjects.map((subject) => (
                      <SelectItem key={subject._id} value={subject._id}>{subject.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="create-material-topic">Topic</Label>
                <Input
                  id="create-material-topic"
                  value={createFormData.topic}
                  onChange={(e) => setCreateFormData({ ...createFormData, topic: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-material-tags">Tags (comma-separated)</Label>
              <Input
                id="create-material-tags"
                value={createFormData.tags}
                onChange={(e) => setCreateFormData({ ...createFormData, tags: e.target.value })}
              />
            </div>

            <div className="rounded-lg border border-border p-3 bg-muted/30 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Student Access</p>
                <p className="text-xs text-muted-foreground">
                  {createFormData.shared_with_students ? 'Visible to students' : 'Hidden from students'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateFormData({ ...createFormData, shared_with_students: !createFormData.shared_with_students })}
              >
                {createFormData.shared_with_students ? 'Set Private' : 'Share with Students'}
              </Button>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateMaterialOpen(false)} disabled={isCreatingMaterial}>
                Cancel
              </Button>
              <Button onClick={handleCreateMaterial} disabled={isCreatingMaterial || !createFormData.title.trim()}>
                {isCreatingMaterial ? 'Creating...' : 'Create Material'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Material Dialog ──────────────────────────────────────── */}
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
                <Label htmlFor="edit-material-type">Material Type</Label>
                <Select
                  value={editFormData.material_type}
                  onValueChange={(value: Material['material_type']) => setEditFormData({ ...editFormData, material_type: value })}
                >
                  <SelectTrigger id="edit-material-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="doc">Document</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                    <SelectItem value="link">Link</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-file-url">{editingMaterial?.file_id ? 'Stored File URL' : 'External URL'}</Label>
                <Input
                  id="edit-file-url"
                  value={editFormData.file_url}
                  onChange={(e) => setEditFormData({ ...editFormData, file_url: e.target.value })}
                  disabled={Boolean(editingMaterial?.file_id)}
                  placeholder="https://example.com/resource"
                />
              </div>
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
                    <SelectItem value="none">None</SelectItem>
                    {subjects.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-topic">Topic</Label>
                <Input
                  id="edit-topic"
                  value={editFormData.topic}
                  onChange={(e) => setEditFormData({ ...editFormData, topic: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-tags">Tags (comma-separated)</Label>
              <Input
                id="edit-tags"
                value={editFormData.tags}
                onChange={(e) => setEditFormData({ ...editFormData, tags: e.target.value })}
              />
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

      <Dialog open={isBulkMoveDialogOpen} onOpenChange={setIsBulkMoveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move Selected Materials</DialogTitle>
            <DialogDescription>
              Select a destination folder for the selected materials.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FolderTreePicker
              folders={allFolders}
              excludeIds={new Set()}
              selectedId={bulkMoveDestination}
              onSelect={setBulkMoveDestination}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsBulkMoveDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleBulkMove} disabled={isBulkMoving}>
                {isBulkMoving ? 'Moving...' : 'Move Selected'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteModal
        open={isBulkDeleteDialogOpen}
        onOpenChange={setIsBulkDeleteDialogOpen}
        onConfirm={handleBulkDelete}
        title="Delete selected materials?"
        description={`The selected ${selectedMaterialIds.size} material${selectedMaterialIds.size !== 1 ? 's will' : ' will'} be archived and removed from the active library.`}
        loading={isBulkDeleting}
      />
    </div>
  )
}
