import { useState, useMemo } from 'react'
import { ChevronRight, ChevronDown, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MaterialFolder } from './types'

interface FolderTreePickerProps {
  folders: MaterialFolder[]
  excludeIds: Set<string>
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export default function FolderTreePicker({
  folders,
  excludeIds,
  selectedId,
  onSelect,
}: FolderTreePickerProps) {
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
