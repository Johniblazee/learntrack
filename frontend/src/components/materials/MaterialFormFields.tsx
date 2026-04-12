import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import type { Material, MaterialFormState, Subject } from './types'

interface MaterialFormFieldsProps {
  form: MaterialFormState
  onChange: (form: MaterialFormState) => void
  subjects: Subject[]
  urlDisabled?: boolean
  urlLabel?: string
}

export default function MaterialFormFields({
  form,
  onChange,
  subjects,
  urlDisabled,
  urlLabel,
}: MaterialFormFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="material-title">Title *</Label>
        <Input
          id="material-title"
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="material-description">Description</Label>
        <Textarea
          id="material-description"
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="material-type">Material Type *</Label>
          <Select
            value={form.material_type}
            onValueChange={(value: Material['material_type']) => onChange({ ...form, material_type: value })}
          >
            <SelectTrigger id="material-type"><SelectValue /></SelectTrigger>
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
          <Label htmlFor="material-url">
            {urlLabel ?? (form.material_type === 'link' ? 'Link URL *' : 'External URL')}
          </Label>
          <Input
            id="material-url"
            value={form.file_url}
            onChange={(e) => onChange({ ...form, file_url: e.target.value })}
            disabled={urlDisabled}
            placeholder="https://example.com/resource"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="material-subject">Subject</Label>
          <Select
            value={form.subject_id || 'none'}
            onValueChange={(value) => onChange({ ...form, subject_id: value === 'none' ? '' : value })}
          >
            <SelectTrigger id="material-subject"><SelectValue placeholder="Select subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {subjects.map((subject) => (
                <SelectItem key={subject._id} value={subject._id}>{subject.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="material-topic">Topic</Label>
          <Input
            id="material-topic"
            value={form.topic}
            onChange={(e) => onChange({ ...form, topic: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="material-tags">Tags (comma-separated)</Label>
        <Input
          id="material-tags"
          value={form.tags}
          onChange={(e) => onChange({ ...form, tags: e.target.value })}
        />
      </div>

      <div className="rounded-lg border border-border p-3 bg-muted/30 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Student Access</p>
          <p className="text-xs text-muted-foreground">
            {form.shared_with_students ? 'Visible to students' : 'Hidden from students'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange({ ...form, shared_with_students: !form.shared_with_students })}
        >
          {form.shared_with_students ? 'Set Private' : 'Share with Students'}
        </Button>
      </div>
    </div>
  )
}
