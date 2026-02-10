/**
 * Reusable modal for viewing item details
 * Provides consistent UX across the application
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Eye } from 'lucide-react'

interface ViewDetailsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
}

/**
 * Modal for viewing item details
 * @param open - Whether modal is open
 * @param onOpenChange - Callback when modal open state changes
 * @param title - Modal title
 * @param description - Optional modal description
 * @param children - Content to display in modal
 * 
 * @example
 * <ViewDetailsModal
 *   open={viewModalOpen}
 *   onOpenChange={setViewModalOpen}
 *   title={`Student: ${student.name}`}
 * >
 *   <div>Student details here...</div>
 * </ViewDetailsModal>
 */
export function ViewDetailsModal({
  open,
  onOpenChange,
  title,
  description,
  children
}: ViewDetailsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-blue-600" />
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        <div className="mt-4">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}

