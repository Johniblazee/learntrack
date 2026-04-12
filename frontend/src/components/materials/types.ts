export interface Material {
  _id: string
  title: string
  description?: string
  material_type: 'pdf' | 'doc' | 'video' | 'link' | 'image' | 'other'
  file_url?: string
  file_id?: string
  file_size?: number
  subject_id?: string
  folder_id?: string | null
  folder_path?: string | null
  topic?: string
  tags: string[]
  status: 'active' | 'archived' | 'draft'
  view_count: number
  download_count: number
  created_at: string
  shared_with_students: boolean
}

export interface Subject {
  _id: string
  name: string
}

export interface MaterialFolder {
  _id: string
  name: string
  parent_id: string | null
  path: string
  created_at: string
  updated_at: string
}

export interface BreadcrumbSegment {
  id: string
  name: string
}

export interface BulkMaterialActionResponse {
  requested_count?: number
  updated_count?: number
  updated_material_ids?: string[]
  skipped_count?: number
  skipped_material_ids?: string[]
}

export interface MaterialFormState {
  title: string
  description: string
  material_type: Material['material_type']
  file_url: string
  subject_id: string
  topic: string
  tags: string
  shared_with_students: boolean
  file_size: number
}

export const createEmptyMaterialForm = (): MaterialFormState => ({
  title: '',
  description: '',
  material_type: 'link',
  file_url: '',
  subject_id: '',
  topic: '',
  tags: '',
  shared_with_students: true,
  file_size: 0,
})
