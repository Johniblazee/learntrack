import { Button } from '@/components/ui/button'
import { FolderInput, Share2, Trash2 } from 'lucide-react'

interface BulkActionsBarProps {
  selectedCount: number
  isBulkSharing: boolean
  onDeselectAll: () => void
  onBulkMove: () => void
  onBulkShare: () => void
  onBulkMakePrivate: () => void
  onBulkDelete: () => void
}

export default function BulkActionsBar({
  selectedCount,
  isBulkSharing,
  onDeselectAll,
  onBulkMove,
  onBulkShare,
  onBulkMakePrivate,
  onBulkDelete,
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="sticky bottom-0 z-40 pt-2">
      <div className="bg-card border border-border rounded-lg shadow-lg p-4 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {selectedCount} material{selectedCount !== 1 ? 's' : ''} selected
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onDeselectAll}>
            Deselect All
          </Button>
          <Button variant="outline" size="sm" onClick={onBulkMove}>
            <FolderInput className="w-4 h-4 mr-1" />
            Move
          </Button>
          <Button variant="outline" size="sm" onClick={onBulkShare} disabled={isBulkSharing}>
            <Share2 className="w-4 h-4 mr-1" />
            Share
          </Button>
          <Button variant="outline" size="sm" onClick={onBulkMakePrivate} disabled={isBulkSharing}>
            <Share2 className="w-4 h-4 mr-1" />
            Make Private
          </Button>
          <Button variant="destructive" size="sm" onClick={onBulkDelete}>
            <Trash2 className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}
