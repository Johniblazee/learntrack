import { useState } from 'react'
import { AlertTriangle, CheckSquare, Power, PowerOff, Square, Trash2 } from 'lucide-react'

import { LoadingSpinner } from '@/components/ui/loading-state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export type BatchOperationType = 'activate' | 'deactivate' | 'delete' | 'suspend'

interface BatchOperationsPanelProps {
  selectedIds: string[]
  totalItems: number
  onSelectAll: () => void
  onClearSelection: () => void
  onBatchOperation: (operation: BatchOperationType, reason?: string) => Promise<void>
  isLoading: boolean
  entityType: 'users' | 'tenants'
}

export function BatchOperationsPanel({
  selectedIds,
  totalItems,
  onSelectAll,
  onClearSelection,
  onBatchOperation,
  isLoading,
  entityType
}: BatchOperationsPanelProps) {
  const [showConfirm, setShowConfirm] = useState<BatchOperationType | null>(null)
  const [reason, setReason] = useState('')

  const handleOperation = async (operation: BatchOperationType) => {
    if (operation === 'delete' || operation === 'suspend' || operation === 'deactivate') {
      setShowConfirm(operation)
    } else {
      await onBatchOperation(operation)
    }
  }

  const confirmOperation = async () => {
    if (showConfirm) {
      await onBatchOperation(showConfirm, reason || undefined)
      setShowConfirm(null)
      setReason('')
    }
  }

  if (selectedIds.length === 0) return null

  const operationLabels: Record<BatchOperationType, string> = {
    activate: 'Activate',
    deactivate: 'Deactivate',
    delete: 'Delete',
    suspend: 'Suspend'
  }

  return (
    <>
      {/* Batch Actions Bar */}
      <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckSquare className="w-5 h-5 text-primary" />
            <span className="font-medium text-primary">
              {selectedIds.length} of {totalItems} selected
            </span>
            <Button
              variant="link"
              size="sm"
              onClick={selectedIds.length === totalItems ? onClearSelection : onSelectAll}
            >
              {selectedIds.length === totalItems ? 'Clear selection' : 'Select all'}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {/* Activate Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOperation('activate')}
              disabled={isLoading}
              className="text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-900/50 hover:bg-green-200 dark:hover:bg-green-900/50"
            >
              <Power className="w-4 h-4" />
              Activate
            </Button>

            {/* Deactivate Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOperation('deactivate')}
              disabled={isLoading}
              className="text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-900/50 hover:bg-orange-200 dark:hover:bg-orange-900/50"
            >
              <PowerOff className="w-4 h-4" />
              {entityType === 'tenants' ? 'Suspend' : 'Deactivate'}
            </Button>

            {/* Delete Button (Users only) */}
            {entityType === 'users' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOperation('delete')}
                disabled={isLoading}
                className="text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-900/50 hover:bg-red-200 dark:hover:bg-red-900/50"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
            )}

            {/* Clear Selection */}
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              <Square className="w-4 h-4" />
              Clear
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(showConfirm)}
        onOpenChange={(open) => {
          if (!open) {
            setShowConfirm(null)
            setReason('')
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Confirm {showConfirm ? operationLabels[showConfirm] : ''}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to {showConfirm} {selectedIds.length} {entityType}?
              {showConfirm === 'delete' && ' This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>

          {(showConfirm === 'suspend' || showConfirm === 'deactivate') && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Reason (optional)
              </label>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Enter reason for this action..."
              />
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirm(null)
                setReason('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmOperation}
              disabled={isLoading}
            >
              {isLoading && <LoadingSpinner size="sm" className="text-white" />}
              Confirm {showConfirm ? operationLabels[showConfirm] : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

