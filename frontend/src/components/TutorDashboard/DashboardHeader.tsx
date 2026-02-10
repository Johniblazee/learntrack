import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Plus,
  Bell,
  User,
  LogOut,
  Settings,
} from "lucide-react"
import { useUser, useClerk } from "@clerk/clerk-react"
import { useNavigate } from "react-router-dom"

interface DashboardHeaderProps {
  onCreateAssignment: () => void
}

export function DashboardHeader({ onCreateAssignment }: DashboardHeaderProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications] = useState<any[]>([])
  const { user } = useUser()
  const { signOut } = useClerk()
  const navigate = useNavigate()

  const unreadCount: number = 0
  const allRead = true

  // Mark all notifications as read/unread
  const handleMarkAllToggle = () => {
    // No-op for now since notifications array is empty
  }

  // Navigation handlers
  const handleProfileClick = () => {
    navigate('/profile')
  }

  const handleSettingsClick = () => {
    navigate('/settings')
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  // Get user display name
  const getUserDisplayName = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName} ${user.lastName}`
    }
    if (user?.fullName) {
      return user.fullName
    }
    if (user?.firstName) {
      return user.firstName
    }
    return 'User'
  }

  return (
    <header className="sticky top-0 z-50 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Left Section */}
        <div className="flex items-center space-x-2 sm:space-x-4">
          <SidebarTrigger />
          <div>
            <h1 className="text-lg sm:text-2xl font-semibold text-slate-900 dark:text-white">Dashboard</h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 hidden sm:block">
              Welcome back, {getUserDisplayName()}
            </p>
          </div>
        </div>

        {/* Right Section */}
        <div className="flex items-center space-x-2 sm:space-x-4">
          {/* New Assignment Button - Desktop */}
          <Button
            onClick={onCreateAssignment}
            className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white hidden sm:flex"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Assignment
          </Button>

          {/* New Assignment Button - Mobile */}
          <Button
            onClick={onCreateAssignment}
            className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white sm:hidden p-2"
          >
            <Plus className="h-4 w-4" />
          </Button>

          {/* Notifications Popover */}
          <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="relative">
                <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 sm:h-5 sm:w-5 bg-red-500 rounded-full text-[10px] sm:text-xs text-white flex items-center justify-center font-medium">
                    {unreadCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">Notifications</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleMarkAllToggle}
                    className="h-7 text-xs text-primary hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-200"
                  >
                    {allRead ? 'Mark all unread' : 'Mark all read'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  You have {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length > 0 ? (
                  notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`group p-4 border-b border-border last:border-0 hover:bg-accent hover:text-accent-foreground cursor-pointer transition-all duration-200 ${
                        notification.unread ? 'bg-primary/5 border-primary/20' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium group-hover:text-accent-foreground">
                            {notification.title}
                          </p>
                          <p className="text-sm opacity-90 mt-1 group-hover:text-accent-foreground">
                            {notification.message}
                          </p>
                          <p className="text-xs opacity-70 mt-1 group-hover:text-accent-foreground">
                            {notification.time}
                          </p>
                        </div>
                        {notification.unread && (
                          <div className="w-2 h-2 bg-primary rounded-full mt-1 flex-shrink-0"></div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center">
                    <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">No notifications</p>
                  </div>
                )}
              </div>
              {notifications.length > 0 && (
                <div className="p-2 border-t border-border">
                  <Button variant="ghost" className="w-full text-sm text-primary hover:bg-accent hover:text-accent-foreground transition-all duration-200">
                    See more notifications
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Profile Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-blue-600 dark:bg-blue-500 text-white">
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs leading-none text-slate-500 dark:text-slate-400">
                    {user?.primaryEmailAddress?.emailAddress}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleProfileClick}>
                <User className="h-4 w-4 mr-2" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSettingsClick}>
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-red-600 dark:text-red-400">
                <LogOut className="h-4 w-4 mr-2" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}










