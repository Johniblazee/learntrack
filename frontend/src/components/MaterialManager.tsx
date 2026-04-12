import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
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
  Upload, FolderPlus, FolderInput, MoreVertical, Pencil, Trash2, Plus,
} from 'lucide-react'
import { API_BASE_URL } from '@/lib/config'
import { useSubjects } from '@/hooks/useQueries'

import type {
  Material,
  Subject,
  MaterialFolder,
  BreadcrumbSegment,
  BulkMaterialActionResponse,
  MaterialFormState,
} from './materials/types'
import { createEmptyMaterialForm } from './materials/types'
import { inferMaterialType } from './materials/helpers'
import FolderTreePicker from './materials/FolderTreePicker'
import MaterialFormFields from './materials/MaterialFormFields'
import MaterialTable from './materials/MaterialTable'
import BulkActionsBar from './materials/BulkActionsBar'

export default function MaterialManager() {
  const { getToken } = useAuth()

  // Core data
  const [materials, setMaterials] = useState<Material[]>([])
  const { data: subjectsData } = useSubjects()
  const subjects = useMemo<Subject[]>(() => {
    if (Array.isArray(subjectsData)) return subjectsData as Subject[]
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

  // Move dialog
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
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
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

  useEffect(() => { fetchMaterials() }, [])
  useEffect(() => { fetchFoldersForParent(currentFolderId) }, [currentFolderId])
  useEffect(() => { setSelectedMaterialIds(new Set()) }, [currentFolderId])

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
    sortedMaterials.length > 0 && sortedMaterials.every((m) => selectedMaterialIds.has(m._id))
  const someVisibleMaterialsSelected =
    sortedMaterials.some((m) => selectedMaterialIds.has(m._id)) && !allVisibleMaterialsSelected

  const moveExcludeIds = useMemo(() => {
    const ids = new Set<string>()
    if (moveTarget?.type === 'folder') {
      ids.add(moveTarget.id)
      const targetFolder = allFolders.find((f) => f._id === moveTarget.id)
      if (targetFolder) {
        const prefix = targetFolder.path + '/'
        allFolders.forEach((f) => { if (f.path.startsWith(prefix)) ids.add(f._id) })
      }
    }
    return ids
  }, [moveTarget, allFolders])

  const hasContent = folders.length > 0 || currentFolderMaterials.length > 0

  // ─── CRUD handlers ──────────────────────────────────────────────────────────

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
      const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Failed to delete ${deleteTarget.type}`)
      toast.success(`${deleteTarget.type === 'folder' ? 'Folder' : 'Material'} deleted`)
      setIsDeleteDialogOpen(false)
      setDeleteTarget(null)
      if (deleteTarget.type === 'file') {
        setSelectedMaterialIds((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next })
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

  const handleCreateMaterial = async () => {
    if (!createFormData.title.trim()) { toast.error('Material title is required'); return }
    if (createFormData.material_type === 'link' && !createFormData.file_url.trim()) { toast.error('Link URL is required for link materials'); return }
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
        const errPayload = await res.json().catch(() => null)
        throw new Error(errPayload?.detail || 'Failed to create material')
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

  const handleUpdateMaterial = async () => {
    if (!editingMaterial) return
    if (!editFormData.title.trim()) { toast.error('Material title is required'); return }
    if (editFormData.material_type === 'link' && !editFormData.file_url.trim()) { toast.error('Link URL is required for link materials'); return }
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
        const errPayload = await res.json().catch(() => null)
        throw new Error(errPayload?.detail || 'Failed to update material')
      }
      toast.success('Material updated')
      setIsEditDialogOpen(false)
      setEditingMaterial(null)
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update material')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleBulkMove = async () => {
    if (selectedMaterialIds.size === 0) return
    try {
      setIsBulkMoving(true)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/bulk-move`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ material_ids: [...selectedMaterialIds], folder_id: bulkMoveDestination }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to move selected materials')
      }
      const result = await res.json() as BulkMaterialActionResponse
      toast.success('Bulk move completed', { description: `${result.updated_count || 0} moved${result.skipped_count ? `, ${result.skipped_count} skipped` : ''}` })
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
    if (selectedMaterialIds.size === 0) return
    try {
      setIsBulkSharing(true)
      const token = await getToken()
      const res = await fetch(`${API_BASE_URL}/materials/bulk-share`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ material_ids: [...selectedMaterialIds], shared_with_students: sharedWithStudents }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.detail || 'Failed to update sharing')
      }
      const result = await res.json() as BulkMaterialActionResponse
      toast.success(sharedWithStudents ? 'Materials shared with students' : 'Materials made private', { description: `${result.updated_count || 0} updated${result.skipped_count ? `, ${result.skipped_count} skipped` : ''}` })
      setSelectedMaterialIds(new Set())
      fetchMaterials()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update sharing settings')
    } finally {
      setIsBulkSharing(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedMaterialIds.size === 0) return
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
      toast.success('Bulk delete completed', { description: `${result.updated_count || 0} archived${result.skipped_count ? `, ${result.skipped_count} skipped` : ''}` })
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
      const entry: UploadedFile = { id, name: file.name, size: file.size, status: 'uploading', progress: 0, file }
      setUploadFiles((prev) => [...prev, entry])

      try {
        const uploadForm = new FormData()
        uploadForm.append('file', file)

        const uploadResult = await new Promise<{ file_url: string; file_id: string; file_size: number; material_type?: string }>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', `${API_BASE_URL}/materials/upload`)
          xhr.setRequestHeader('Authorization', `Bearer ${token}`)
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 80)
              setUploadFiles((prev) => prev.map((f) => (f.id === id ? { ...f, progress: pct } : f)))
            }
          }
          xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { resolve(JSON.parse(xhr.responseText)) } else { reject(new Error('Upload failed')) } }
          xhr.onerror = () => reject(new Error('Upload failed'))
          xhr.send(uploadForm)
        })

        const materialType = uploadResult.material_type || inferMaterialType(file.name)
        const payload = {
          title: file.name, description: null, material_type: materialType,
          file_url: uploadResult.file_url, file_id: uploadResult.file_id || null,
          file_size: uploadResult.file_size || file.size,
          subject_id: uploadSubjectId || null, folder_id: uploadFolderId || null,
          topic: null, tags: [], shared_with_students: true,
        }

        const res = await fetch(`${API_BASE_URL}/materials/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to create material record')

        setUploadFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: 'completed', progress: 100 } : f)))
      } catch (err) {
        console.error('Upload error:', err)
        setUploadFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: 'error' } : f)))
      }
    }
    fetchMaterials()
  }, [uploadFolderId, uploadSubjectId, getToken])

  const handleRemoveUploadFile = useCallback((id: string) => {
    setUploadFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  // ─── Dialog openers ─────────────────────────────────────────────────────────

  const openEditDialog = (material: Material) => {
    setEditingMaterial(material)
    setEditFormData({
      title: material.title, description: material.description || '',
      material_type: material.material_type, file_url: material.file_url || '',
      subject_id: material.subject_id || '', topic: material.topic || '',
      tags: material.tags.join(', '), shared_with_students: material.shared_with_students,
      file_size: material.file_size || 0,
    })
    setIsEditDialogOpen(true)
  }

  const handleToggleSelectMaterial = (materialId: string) => {
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev)
      if (next.has(materialId)) next.delete(materialId)
      else next.add(materialId)
      return next
    })
  }

  const handleSelectAllVisibleMaterials = () => {
    const visibleIds = sortedMaterials.map((m) => m._id)
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev)
      if (visibleIds.every((id) => next.has(id))) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {breadcrumbTrail.length > 0 ? (
            <div>
              <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                <button type="button" className="hover:text-foreground transition-colors" onClick={navigateToRoot}>Materials</button>
                {breadcrumbTrail.map((seg, i) => (
                  <span key={seg.id} className="flex items-center gap-1">
                    <span>/</span>
                    {i === breadcrumbTrail.length - 1
                      ? <span className="text-foreground font-medium">{seg.name}</span>
                      : <button type="button" className="hover:text-foreground transition-colors" onClick={() => navigateToBreadcrumb(i)}>{seg.name}</button>}
                  </span>
                ))}
              </div>
              <h1 className="text-3xl font-bold text-foreground">{currentFolderName}</h1>
            </div>
          ) : (
            <div>
              <h1 className="text-3xl font-bold text-foreground">Learning Materials</h1>
              <p className="text-muted-foreground mt-1">Upload and organize learning resources for your students.</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setNewFolderName(''); setCreateFolderParentId(currentFolderId); fetchAllFolders(); setIsCreateFolderOpen(true) }}>
            <FolderPlus className="w-4 h-4 mr-2" />New Folder
          </Button>
          <Button variant="outline" onClick={() => { setCreateFormData(createEmptyMaterialForm()); setIsCreateMaterialOpen(true) }}>
            <Plus className="w-4 h-4 mr-2" />Add Material
          </Button>
          <Button onClick={() => { setUploadSubjectId(null); setUploadFiles([]); setUploadFolderId(currentFolderId); fetchAllFolders(); setIsUploadModalOpen(true) }}>
            <Upload className="w-4 h-4 mr-2" />Upload New
          </Button>
        </div>
      </div>

      {/* Folder grid */}
      {foldersLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 pt-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="w-48 h-32 rounded-xl" />)}
        </div>
      ) : folders.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 pt-2">
          {folders.map((folder) => (
            <div key={folder._id} className="relative group w-fit">
              <FolderCard name={folder.name} count={folderFileCounts[folder._id] || 0} onClick={() => navigateToFolder(folder)} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity z-10 bg-white/80 hover:bg-white shadow-sm rounded-full" onClick={(e) => e.stopPropagation()}>
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { setRenamingFolder(folder); setRenameFolderName(folder.name); setIsRenameFolderOpen(true) }}>
                    <Pencil className="w-4 h-4 mr-2" />Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setMoveTarget({ type: 'folder', id: folder._id, name: folder.name }); setSelectedDestination(null); fetchAllFolders(); setIsMoveDialogOpen(true) }}>
                    <FolderInput className="w-4 h-4 mr-2" />Move
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { setDeleteTarget({ type: 'folder', id: folder._id, name: folder.name }); setIsDeleteDialogOpen(true) }}>
                    <Trash2 className="w-4 h-4 mr-2" />Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {/* Material table */}
      <MaterialTable
        materials={sortedMaterials}
        loading={loading}
        hasContent={hasContent}
        currentFolderId={currentFolderId}
        selectedIds={selectedMaterialIds}
        allSelected={allVisibleMaterialsSelected}
        someSelected={someVisibleMaterialsSelected}
        searchTerm={searchTerm}
        typeFilter={typeFilter}
        sortBy={sortBy}
        showFilters={currentFolderMaterials.length > 0 || !!searchTerm || typeFilter !== 'all'}
        isTogglingShareId={isTogglingShareId}
        onSearchChange={setSearchTerm}
        onTypeFilterChange={setTypeFilter}
        onSortChange={setSortBy}
        onSelectAll={handleSelectAllVisibleMaterials}
        onToggleSelect={handleToggleSelectMaterial}
        onEdit={openEditDialog}
        onToggleShare={handleToggleShare}
        onMove={(m) => { setMoveTarget({ type: 'file', id: m._id, name: m.title }); setSelectedDestination(null); fetchAllFolders(); setIsMoveDialogOpen(true) }}
        onDelete={(m) => { setDeleteTarget({ type: 'file', id: m._id, name: m.title }); setIsDeleteDialogOpen(true) }}
      />

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selectedMaterialIds.size}
        isBulkSharing={isBulkSharing}
        onDeselectAll={() => setSelectedMaterialIds(new Set())}
        onBulkMove={() => { setBulkMoveDestination(currentFolderId); fetchAllFolders(); setIsBulkMoveDialogOpen(true) }}
        onBulkShare={() => handleBulkShare(true)}
        onBulkMakePrivate={() => handleBulkShare(false)}
        onBulkDelete={() => setIsBulkDeleteDialogOpen(true)}
      />

      {/* ── Create Folder Dialog ──────────────────────────────────────── */}
      <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>Choose a name and location for the new folder.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-folder-name">Folder name</Label>
              <Input id="new-folder-name" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder() }} placeholder="e.g., Chapter 1" autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Parent folder</Label>
              <FolderTreePicker folders={allFolders} excludeIds={new Set()} selectedId={createFolderParentId} onSelect={setCreateFolderParentId} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateFolderOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateFolder} disabled={!newFolderName.trim() || isCreatingFolder}>{isCreatingFolder ? 'Creating...' : 'Create Folder'}</Button>
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
              <Input id="rename-folder" value={renameFolderName} onChange={(e) => setRenameFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder() }} autoFocus />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsRenameFolderOpen(false)}>Cancel</Button>
              <Button onClick={handleRenameFolder} disabled={!renameFolderName.trim() || isRenamingFolder}>{isRenamingFolder ? 'Renaming...' : 'Rename'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Move Dialog ───────────────────────────────────────────────── */}
      <Dialog open={isMoveDialogOpen} onOpenChange={(open) => { setIsMoveDialogOpen(open); if (!open) setMoveTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move {moveTarget?.type === 'folder' ? 'Folder' : 'File'}</DialogTitle>
            <DialogDescription>Select a destination for &ldquo;{moveTarget?.name}&rdquo;.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FolderTreePicker folders={allFolders} excludeIds={moveExcludeIds} selectedId={selectedDestination} onSelect={setSelectedDestination} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsMoveDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleMove} disabled={isMoving}>{isMoving ? 'Moving...' : 'Move Here'}</Button>
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
        description={deleteTarget?.type === 'folder' ? `The folder "${deleteTarget.name}" will be deleted. Files inside will be moved to the parent folder.` : undefined}
        loading={isDeleting}
      />

      {/* ── Upload Modal ──────────────────────────────────────────────── */}
      <Dialog open={isUploadModalOpen} onOpenChange={(open) => { setIsUploadModalOpen(open); if (!open) { setUploadFiles([]); setUploadSubjectId(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Materials</DialogTitle>
            <DialogDescription>Choose a location and drag & drop files to upload.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Location</Label>
              <FolderTreePicker folders={allFolders} excludeIds={new Set()} selectedId={uploadFolderId} onSelect={setUploadFolderId} />
            </div>
            <div className="space-y-2">
              <Label>Subject <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select value={uploadSubjectId || 'none'} onValueChange={(v) => setUploadSubjectId(v === 'none' ? null : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {subjects.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <FileUploadCard files={uploadFiles} onFilesAdded={handleFilesAdded} onRemoveFile={handleRemoveUploadFile} />
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create Material Dialog ────────────────────────────────────── */}
      <Dialog open={isCreateMaterialOpen} onOpenChange={(open) => { setIsCreateMaterialOpen(open); if (!open) setCreateFormData(createEmptyMaterialForm()) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Material</DialogTitle>
            <DialogDescription>Create a link or external resource record for the current folder.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <MaterialFormFields form={createFormData} onChange={setCreateFormData} subjects={subjects} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateMaterialOpen(false)} disabled={isCreatingMaterial}>Cancel</Button>
              <Button onClick={handleCreateMaterial} disabled={isCreatingMaterial || !createFormData.title.trim()}>{isCreatingMaterial ? 'Creating...' : 'Create Material'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Material Dialog ──────────────────────────────────────── */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => { setIsEditDialogOpen(open); if (!open) setEditingMaterial(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Material</DialogTitle>
            <DialogDescription>Update details and sharing settings for this material.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <MaterialFormFields
              form={editFormData}
              onChange={setEditFormData}
              subjects={subjects}
              urlDisabled={Boolean(editingMaterial?.file_id)}
              urlLabel={editingMaterial?.file_id ? 'Stored File URL' : undefined}
            />
            <Button onClick={handleUpdateMaterial} className="w-full" disabled={!editFormData.title.trim() || isSavingEdit}>{isSavingEdit ? 'Saving...' : 'Save Changes'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Move Dialog ──────────────────────────────────────────── */}
      <Dialog open={isBulkMoveDialogOpen} onOpenChange={setIsBulkMoveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move Selected Materials</DialogTitle>
            <DialogDescription>Select a destination folder for the selected materials.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FolderTreePicker folders={allFolders} excludeIds={new Set()} selectedId={bulkMoveDestination} onSelect={setBulkMoveDestination} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsBulkMoveDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleBulkMove} disabled={isBulkMoving}>{isBulkMoving ? 'Moving...' : 'Move Selected'}</Button>
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
