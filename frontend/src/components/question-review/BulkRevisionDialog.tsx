import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface BulkRevisionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notes: string
  onNotesChange: (notes: string) => void
  onSubmit: () => void
}

export default function BulkRevisionDialog({
  open,
  onOpenChange,
  notes,
  onNotesChange,
  onSubmit,
}: BulkRevisionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Request Revision for Selected Questions</DialogTitle>
          <DialogDescription>
            Add revision guidance that will be attached to each selected pending draft.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="bulk-revision-notes">Revision Notes</Label>
          <Textarea
            id="bulk-revision-notes"
            rows={5}
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Explain what should be improved before approval..."
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!notes.trim()}>
            Request Revision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
