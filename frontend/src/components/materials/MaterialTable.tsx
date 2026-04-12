import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Edit, Share2, FolderInput, Trash2, Search, Folder,
} from 'lucide-react'
import { cn } from '@/lib/utils'

import type { Material } from './types'
import { getFileIcon, formatFileSize } from './helpers'

interface MaterialTableProps {
  materials: Material[]
  loading: boolean
  hasContent: boolean
  currentFolderId: string | null
  selectedIds: Set<string>
  allSelected: boolean
  someSelected: boolean
  searchTerm: string
  typeFilter: string
  sortBy: 'date' | 'name'
  showFilters: boolean
  isTogglingShareId: string | null
  onSearchChange: (value: string) => void
  onTypeFilterChange: (value: string) => void
  onSortChange: (value: 'date' | 'name') => void
  onSelectAll: () => void
  onToggleSelect: (id: string) => void
  onEdit: (material: Material) => void
  onToggleShare: (material: Material) => void
  onMove: (material: Material) => void
  onDelete: (material: Material) => void
}

export default function MaterialTable({
  materials,
  loading,
  hasContent,
  currentFolderId,
  selectedIds,
  allSelected,
  someSelected,
  searchTerm,
  typeFilter,
  sortBy,
  showFilters,
  isTogglingShareId,
  onSearchChange,
  onTypeFilterChange,
  onSortChange,
  onSelectAll,
  onToggleSelect,
  onEdit,
  onToggleShare,
  onMove,
  onDelete,
}: MaterialTableProps) {
  const checkboxValue = allSelected ? true : someSelected ? ('indeterminate' as const) : false

  return (
    <>
      {showFilters && (
        <div className="bg-muted/30 border border-border rounded-lg p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search materials..."
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-10 bg-background border-border h-10"
              />
            </div>
            <Select value={typeFilter} onValueChange={onTypeFilterChange}>
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
            <Select value={sortBy} onValueChange={(v: 'date' | 'name') => onSortChange(v)}>
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

      {loading ? (
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-12"><Checkbox checked={checkboxValue} onCheckedChange={onSelectAll} aria-label="Select all" /></TableHead>
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
      ) : materials.length > 0 ? (
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-12"><Checkbox checked={checkboxValue} onCheckedChange={onSelectAll} aria-label="Select all visible materials" /></TableHead>
                <TableHead>File Name</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map((material) => (
                <TableRow key={material._id} className={cn('hover:bg-muted/30 transition-colors', selectedIds.has(material._id) && 'bg-primary/5')}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(material._id)}
                      onCheckedChange={() => onToggleSelect(material._id)}
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
                    {new Date(material.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatFileSize(material.file_size)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {material.shared_with_students ? 'All Students' : 'Private'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onEdit(material)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onToggleShare(material)} disabled={isTogglingShareId === material._id}>
                        <Share2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onMove(material)} title="Move to folder">
                        <FolderInput className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => onDelete(material)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : !hasContent ? (
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
    </>
  )
}
