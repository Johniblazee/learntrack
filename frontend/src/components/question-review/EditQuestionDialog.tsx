import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface EditForm {
  question_text: string
  options_text: string
  correct_answer: string
  explanation: string
}

interface EditQuestionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: EditForm
  onFormChange: (form: EditForm) => void
  onSave: () => void
  saving: boolean
}

export default function EditQuestionDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  onSave,
  saving,
}: EditQuestionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit Question</DialogTitle>
          <DialogDescription>
            Make quick corrections before approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-question-text">Question Text</Label>
            <Textarea
              id="edit-question-text"
              rows={4}
              value={form.question_text}
              onChange={(e) => onFormChange({ ...form, question_text: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-question-options">Options (one per line)</Label>
            <Textarea
              id="edit-question-options"
              rows={5}
              value={form.options_text}
              onChange={(e) => onFormChange({ ...form, options_text: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-correct-answer">Correct Answer</Label>
            <Input
              id="edit-correct-answer"
              value={form.correct_answer}
              onChange={(e) => onFormChange({ ...form, correct_answer: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-explanation">Explanation</Label>
            <Textarea
              id="edit-explanation"
              rows={4}
              value={form.explanation}
              onChange={(e) => onFormChange({ ...form, explanation: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || !form.question_text.trim()}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
