import { Bell, LogOut, Moon, Settings, Sun } from 'lucide-react'

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
import { useTheme } from '@/contexts/ThemeContext'
import { useNotifications, useUnreadNotificationCount } from '@/hooks/useQueries'

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
  const { theme, toggleTheme } = useTheme()
  const { data: notificationResponse } = useNotifications(1, 5)
  const { data: unreadResponse } = useUnreadNotificationCount()

  const notifications = Array.isArray(notificationResponse?.items)
    ? notificationResponse.items
    : []
  const unreadCount =
    typeof unreadResponse?.unread_count === 'number' ? unreadResponse.unread_count : 0

  const handleSignOutClick = () => {
    void onSignOut()
  }

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
                {unreadCount}
              </Badge>
            )}
            <span className="sr-only">Notifications</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="w-80 rounded-lg">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Notifications</span>
            <span className="text-xs text-muted-foreground">{unreadCount} unread</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {notifications.length === 0 ? (
              <DropdownMenuItem disabled>
                <span className="text-sm text-muted-foreground">No notifications</span>
              </DropdownMenuItem>
            ) : (
              notifications.slice(0, 4).map((notification: any, index: number) => (
                <DropdownMenuItem
                  key={String(notification?.id ?? notification?._id ?? `notification-${index}`)}
                >
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{notification?.title || 'Notification'}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {notification?.message || 'No details provided'}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="icon" onClick={toggleTheme}>
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        <span className="sr-only">Toggle theme</span>
      </Button>

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
