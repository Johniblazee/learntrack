import { FileText, FileImage, FileVideo, File, Link } from 'lucide-react'
import type { Material } from './types'

export function getFileIcon(type: Material['material_type']) {
  const cls = 'w-5 h-5'
  switch (type) {
    case 'pdf':   return <FileText className={`${cls} text-red-500`} />
    case 'doc':   return <FileText className={`${cls} text-blue-500`} />
    case 'video': return <FileVideo className={`${cls} text-purple-500`} />
    case 'image': return <FileImage className={`${cls} text-green-500`} />
    case 'link':  return <Link className={`${cls} text-cyan-500`} />
    default:      return <File className={`${cls} text-muted-foreground`} />
  }
}

export function formatFileSize(bytes?: number) {
  if (!bytes) return 'N/A'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function inferMaterialType(fileName: string): Material['material_type'] {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext || '')) return 'doc'
  if (['mp4', 'mov', 'avi', 'webm'].includes(ext || '')) return 'video'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return 'image'
  return 'other'
}
