/**
 * SessionDrawer - A drawer component to display the history of generation sessions.
 * Allows users to review and resume past sessions.
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import {
  History,
  FileQuestion,
  CheckCircle,
  RefreshCw,
  MoreVertical,
  Trash2,
  Eye,
  Copy,
  CheckSquare,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

interface SessionQuestion {
  question_id: string
  question_text: string
  type: string
  difficulty: string
  status: 'pending' | 'approved' | 'rejected'
}

interface Session {
  session_id: string
  prompt: string
  created_at: string
  status: 'completed' | 'failed' | 'in_progress' | 'pending'
  question_count: number
  approved_count: number
  pending_count: number
  rejected_count: number
  questions?: SessionQuestion[]
}

interface SessionDrawerProps {
  sessions: Session[]
  isLoading: boolean
  onRefresh: () => void
  onSelectSession: (sessionId: string) => void
  onDeleteSession?: (sessionId: string) => Promise<void>
  selectedSessionId?: string | null
}

export function SessionDrawer({
  sessions,
  isLoading,
  onRefresh,
  onSelectSession,
  onDeleteSession,
  selectedSessionId,
}: SessionDrawerProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set())

  const handleDeleteClick = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setSessionToDelete(sessionId)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!onDeleteSession) return

    setIsDeleting(true)
    try {
      if (selectionMode && selectedSessions.size > 0) {
        // Bulk delete
        const sessionsToDelete = Array.from(selectedSessions)
        for (const sid of sessionsToDelete) {
          await onDeleteSession(sid)
        }
        toast.success(`${sessionsToDelete.length} session(s) deleted`)
        setSelectedSessions(new Set())
        setSelectionMode(false)
      } else if (sessionToDelete) {
        // Single delete
        await onDeleteSession(sessionToDelete)
        toast.success('Session deleted')
      }
    } catch {
      toast.error('Failed to delete session(s)')
    } finally {
      setIsDeleting(false)
      setDeleteDialogOpen(false)
      setSessionToDelete(null)
    }
  }

  const toggleSessionSelection = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setSelectedSessions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId)
      } else {
        newSet.add(sessionId)
      }
      return newSet
    })
  }

  const toggleSelectAll = () => {
    if (selectedSessions.size === sessions.length) {
      setSelectedSessions(new Set())
    } else {
      setSelectedSessions(new Set(sessions.map(s => s.session_id)))
    }
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedSessions(new Set())
  }

  const handleBulkDeleteClick = () => {
    if (selectedSessions.size === 0) return
    setSessionToDelete(null) // Clear single session delete
    setDeleteDialogOpen(true)
  }

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <History className="h-4 w-4" />
            History
            {sessions.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {sessions.length}
              </Badge>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-full max-w-[100vw] sm:max-w-[400px] md:max-w-[480px] p-0">
          <SheetHeader className="p-3 sm:p-4 border-b">
            <div className="flex items-center justify-between gap-2">
              {selectionMode ? (
                <>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={exitSelectionMode}
                      className="h-8 w-8"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium">
                      {selectedSessions.size} selected
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleSelectAll}
                      className="text-xs"
                    >
                      {selectedSessions.size === sessions.length ? 'Deselect All' : 'Select All'}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBulkDeleteClick}
                      disabled={selectedSessions.size === 0}
                      className="gap-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <SheetTitle className="flex items-center gap-2 text-base sm:text-lg">
                    <History className="h-4 w-4 sm:h-5 sm:w-5" />
                    <span className="truncate">Generation History</span>
                  </SheetTitle>
                  <div className="flex items-center gap-1">
                    {sessions.length > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectionMode(true)}
                        className="h-8 w-8 sm:h-9 sm:w-9"
                        title="Select multiple"
                      >
                        <CheckSquare className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={onRefresh}
                      disabled={isLoading}
                      className="h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0"
                    >
                      <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                    </Button>
                  </div>
                </>
              )}
            </div>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-70px)] sm:h-[calc(100vh-80px)]">
            <div className="p-2 sm:p-3 space-y-1">
              {isLoading ? (
                // Loading skeletons
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="p-3 rounded-lg border">
                    <Skeleton className="h-4 w-3/4 mb-2" />
                    <Skeleton className="h-3 w-1/2 mb-2" />
                    <div className="flex gap-2">
                      <Skeleton className="h-5 w-16" />
                    </div>
                  </div>
                ))
              ) : sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FileQuestion className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground">
                    No generation history yet
                  </p>
                </div>
              ) : (
                <AnimatePresence>
                  {sessions.map((session, index) => (
                    <SessionCard
                      key={session.session_id}
                      session={session}
                      index={index}
                      isSelected={selectedSessionId === session.session_id}
                      isChecked={selectedSessions.has(session.session_id)}
                      selectionMode={selectionMode}
                      onClick={() => selectionMode
                        ? toggleSessionSelection(session.session_id, { stopPropagation: () => {}, preventDefault: () => {} } as React.MouseEvent)
                        : onSelectSession(session.session_id)
                      }
                      onCheckChange={(e) => toggleSessionSelection(session.session_id, e)}
                      onDelete={(e) => handleDeleteClick(session.session_id, e)}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectionMode && selectedSessions.size > 0
                ? `Delete ${selectedSessions.size} Session(s)`
                : 'Delete Generation Session'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectionMode && selectedSessions.size > 0
                ? `This will permanently delete ${selectedSessions.size} generation session(s) and all their questions. This action cannot be undone.`
                : 'This will permanently delete this generation session and all its questions. This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              variant="destructive"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface SessionCardProps {
  session: Session
  index: number
  isSelected: boolean
  isChecked?: boolean
  selectionMode?: boolean
  onClick: () => void
  onCheckChange?: (e: React.MouseEvent) => void
  onDelete?: (e: React.MouseEvent) => void
}

function SessionCard({
  session,
  index,
  isSelected,
  isChecked = false,
  selectionMode = false,
  onClick,
  onCheckChange,
  onDelete
}: SessionCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const timeAgo = formatDistanceToNow(new Date(session.created_at), { addSuffix: true })

  const handleCopyPrompt = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(session.prompt || '')
    toast.success('Prompt copied to clipboard')
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.03, duration: 0.2 }}
    >
      <div
        onClick={onClick}
        className={cn(
          'group relative flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg cursor-pointer',
          'transition-all duration-150 ease-out',
          'hover:bg-muted/50',
          isSelected && !selectionMode && 'bg-muted/80 ring-1 ring-border',
          isChecked && selectionMode && 'bg-primary/10 ring-1 ring-primary/50'
        )}
      >
        {/* Checkbox or Icon */}
        {selectionMode ? (
          <div
            className="flex-shrink-0 flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8"
            onClick={onCheckChange}
          >
            <Checkbox
              checked={isChecked}
              className="h-4 w-4 sm:h-5 sm:w-5"
            />
          </div>
        ) : (
          <div className="flex-shrink-0 flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-md border bg-background">
            <FileQuestion className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0 pr-8 sm:pr-10">
          <p className="text-xs sm:text-sm font-medium line-clamp-2 sm:line-clamp-1 break-words leading-relaxed">
            {session.prompt || 'Untitled Generation'}
          </p>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-1.5">
            <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">{timeAgo}</span>
            <span className="text-[10px] sm:text-xs text-muted-foreground">•</span>
            <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">
              {session.question_count} {session.question_count === 1 ? 'question' : 'questions'}
            </span>
            {session.pending_count > 0 && (
              <>
                <span className="text-[10px] sm:text-xs text-muted-foreground">•</span>
                <Badge variant="outline" className="h-4 sm:h-5 px-1.5 text-[10px] sm:text-xs text-amber-500 border-amber-500/50 bg-amber-500/10">
                  {session.pending_count} pending
                </Badge>
              </>
            )}
          </div>
        </div>

        {/* Status indicator - only show when not in selection mode, not hovered, and fully approved */}
        {!selectionMode && !menuOpen && session.approved_count > 0 && session.approved_count === session.question_count && (
          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 group-hover:hidden" />
        )}

        {/* Actions menu - visible on hover via group-hover, hidden in selection mode */}
        {!selectionMode && (
          <div className={cn(
            'absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity',
            menuOpen && 'opacity-100'
          )}>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={onClick}>
                  <Eye className="h-4 w-4 mr-2" />
                  View
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyPrompt}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Prompt
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </motion.div>
  )
}

export default SessionDrawer

