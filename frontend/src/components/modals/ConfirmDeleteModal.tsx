/**
 * Reusable confirmation modal for delete operations
 * Provides consistent UX across the application
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Trash2 } from 'lucide-react'

interface ConfirmDeleteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
  title?: string
  description?: string
  itemName?: string
  loading?: boolean
}

/**
 * Confirmation modal for delete operations
 * @param open - Whether modal is open
 * @param onOpenChange - Callback when modal open state changes
 * @param onConfirm - Callback when delete is confirmed
 * @param title - Modal title (default: "Are you sure?")
 * @param description - Modal description
 * @param itemName - Name of item being deleted
 * @param loading - Whether delete operation is in progress
 * 
 * @example
 * <ConfirmDeleteModal
 *   open={deleteModalOpen}
 *   onOpenChange={setDeleteModalOpen}
 *   onConfirm={handleDelete}
 *   itemName={student.name}
 * />
 */
export function ConfirmDeleteModal({
  open,
  onOpenChange,
  onConfirm,
  title = "Are you sure?",
  description,
  itemName,
  loading = false
}: ConfirmDeleteModalProps) {
  const defaultDescription = itemName
    ? `This will permanently delete "${itemName}". This action cannot be undone.`
    : "This action cannot be undone. This will permanently delete the item."

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-red-600" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {description || defaultDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
          >
            {loading ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

