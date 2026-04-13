import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CloudUpload, File as FileIcon, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export interface UploadedFile {
  id: string
  name: string
  size: number
  status: 'uploading' | 'completed' | 'error'
  progress: number
  file: File
}

interface FileUploadCardProps {
  files: UploadedFile[]
  onFilesAdded: (files: File[]) => void
  onRemoveFile: (id: string) => void
  accept?: string
  className?: string
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileUploadCard({
  files,
  onFilesAdded,
  onRemoveFile,
  accept = '.pdf,.doc,.docx,.mp4,.mov,.avi,.webm,.jpg,.jpeg,.png,.gif,.webp',
  className,
}: FileUploadCardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputId = 'file-upload-card-input'

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const droppedFiles = Array.from(e.dataTransfer.files)
      if (droppedFiles.length > 0) onFilesAdded(droppedFiles)
    },
    [onFilesAdded],
  )

  const handleBrowse = () => fileInputRef.current?.click()

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : []
    if (selected.length > 0) onFilesAdded(selected)
    e.target.value = ''
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Drop zone */}
      <label
        htmlFor={inputId}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowse}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all duration-200',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/50 bg-muted/30',
        )}
      >
        <CloudUpload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm font-medium text-foreground mb-1">
          Drag & drop files here, or click to browse
        </p>
        <p className="text-xs text-muted-foreground">
          PDF, DOCX, PNG, JPG, MP4, and more
        </p>
      </label>

      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple
        onChange={handleInputChange}
        aria-label="Upload files"
      />

      {/* File list */}
      <AnimatePresence mode="popLayout">
        {files.map((f) => (
          <motion.div
            key={f.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
          >
            {/* Icon */}
            {f.status === 'completed' ? (
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
            ) : f.status === 'error' ? (
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
            ) : (
              <FileIcon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            )}

            {/* Info + progress */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground truncate">
                  {f.name}
                </span>
                <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                  {formatSize(f.size)}
                </span>
              </div>
              {f.status === 'uploading' && (
                <Progress value={f.progress} className="h-1.5" />
              )}
              {f.status === 'error' && (
                <p className="text-xs text-destructive">Upload failed</p>
              )}
            </div>

            {/* Remove button */}
            <button
              type="button"
              aria-label={`Remove ${f.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onRemoveFile(f.id)
              }}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
