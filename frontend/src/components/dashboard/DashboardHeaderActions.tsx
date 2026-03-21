import { Bell, CheckCheck, Loader2, LogOut, Settings } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from '@/hooks/useQueries'
import { cn } from '@/lib/utils'

interface DashboardHeaderActionsProps {
  displayName: string
  displayEmail: string
  initials: string
  avatarUrl?: string
  showAvatarImage?: boolean
  onSettings: () => void
  onSignOut: () => void | Promise<void>
}

export function DashboardHeaderActions({
  displayName,
  displayEmail,
  initials,
  avatarUrl,
  showAvatarImage = true,
  onSettings,
  onSignOut,
}: DashboardHeaderActionsProps) {
  const navigate = useNavigate()
  const { data: notificationResponse } = useNotifications(1, 8)
  const { data: unreadResponse } = useUnreadNotificationCount()
  const markNotificationRead = useMarkNotificationRead()
  const markAllNotificationsRead = useMarkAllNotificationsRead()

  const notifications = Array.isArray(notificationResponse?.items)
    ? notificationResponse.items
    : []
  const unreadCount =
    typeof unreadResponse?.unread_count === 'number' ? unreadResponse.unread_count : 0

  const mapTypeToTitle = (notificationType: string): string => {
    const labels: Record<string, string> = {
      assignment_submitted: 'Assignment submitted',
      assignment_graded: 'Assignment graded',
      question_approved: 'Question approved',
      question_rejected: 'Question rejected',
      student_joined: 'Student joined',
      parent_joined: 'Parent joined',
      message_received: 'New message',
      assignment_due_soon: 'Assignment due soon',
      assignment_overdue: 'Assignment overdue',
      invitation_accepted: 'Invitation accepted',
      system: 'System update',
    }

    return labels[notificationType] || 'Notification'
  }

  const resolveNotificationTitle = (notification: any): string => {
    if (typeof notification?.title === 'string' && notification.title.trim()) {
      return notification.title.trim()
    }

    const type =
      typeof notification?.notification_type === 'string'
        ? notification.notification_type
        : 'system'
    return mapTypeToTitle(type)
  }

  const resolveNotificationMessage = (notification: any): string => {
    if (typeof notification?.message === 'string' && notification.message.trim()) {
      return notification.message.trim()
    }
    return 'No details available.'
  }

  const resolveNotificationTime = (notification: any): string => {
    const raw = notification?.created_at
    if (typeof raw !== 'string' || !raw.trim()) {
      return 'just now'
    }

    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) {
      return 'just now'
    }

    return formatDistanceToNow(parsed, { addSuffix: true })
  }

  const getNotificationId = (notification: any): string | null => {
    const raw = notification?.id ?? notification?._id
    return typeof raw === 'string' && raw.trim() ? raw : null
  }

  const handleSignOutClick = () => {
    void onSignOut()
  }

  const handleMarkAllRead = () => {
    if (unreadCount <= 0 || markAllNotificationsRead.isPending) {
      return
    }

    markAllNotificationsRead.mutate()
  }

  const handleNotificationSelect = (notification: any) => {
    const notificationId = getNotificationId(notification)
    const isRead = Boolean(notification?.is_read)

    if (notificationId && !isRead && !markNotificationRead.isPending) {
      markNotificationRead.mutate(notificationId)
    }

    const actionUrl =
      typeof notification?.action_url === 'string' ? notification.action_url.trim() : ''
    if (actionUrl.startsWith('/')) {
      navigate(actionUrl)
    }
  }

  const unreadBadge = unreadCount > 99 ? '99+' : String(unreadCount)

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]"
              >
                {unreadBadge}
              </Badge>
            )}
            <span className="sr-only">Notifications</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="w-80 rounded-lg">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span className="text-sm">Notifications</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{unreadCount} unread</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={handleMarkAllRead}
                disabled={unreadCount <= 0 || markAllNotificationsRead.isPending}
              >
                {markAllNotificationsRead.isPending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <CheckCheck className="mr-1 h-3 w-3" />
                )}
                Mark all read
              </Button>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {notifications.length === 0 ? (
              <DropdownMenuItem disabled>
                <span className="text-sm text-muted-foreground">No notifications</span>
              </DropdownMenuItem>
            ) : (
              notifications.slice(0, 6).map((notification: any, index: number) => {
                const notificationId = getNotificationId(notification)
                const isRead = Boolean(notification?.is_read)

                return (
                <DropdownMenuItem
                  key={String(notificationId ?? `notification-${index}`)}
                  onSelect={() => handleNotificationSelect(notification)}
                  className="items-start gap-2 py-2"
                >
                  <span
                    className={cn(
                      'mt-1 h-2 w-2 rounded-full',
                      isRead ? 'bg-transparent' : 'bg-primary'
                    )}
                  />
                  <div className="flex flex-col gap-1">
                    <span className={cn('text-sm', !isRead && 'font-semibold')}>
                      {resolveNotificationTitle(notification)}
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {resolveNotificationMessage(notification)}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {resolveNotificationTime(notification)}
                    </span>
                  </div>
                </DropdownMenuItem>
                )
              })
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate('/notifications')}>
            View all notifications
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 px-2">
            <Avatar className="h-8 w-8 rounded-lg">
              {showAvatarImage && avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
              <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="min-w-56 rounded-lg">
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar className="h-8 w-8 rounded-lg">
                {showAvatarImage && avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
                <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{displayEmail}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSettings}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOutClick}>
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
