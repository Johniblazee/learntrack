// AdminLayout.tsx - Admin dashboard layout using SidebarProvider
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom'
import { LayoutDashboard, Users, Building2, Settings, Shield, LogOut, Moon, Sun, ArrowLeft, Activity } from 'lucide-react'
import { useUserContext } from '../../contexts/UserContext'
import { useClerk } from '@clerk/clerk-react'
import { useTheme } from '@/contexts/ThemeContext'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"

interface NavItem {
  name: string
  path: string
  icon: React.ElementType
  permission?: string
}

const navItems: NavItem[] = [
  { name: 'Dashboard', path: '/admin', icon: LayoutDashboard },
  { name: 'Tenants', path: '/admin/tenants', icon: Building2, permission: 'view_all_tenants' },
  { name: 'Users', path: '/admin/users', icon: Users, permission: 'view_all_users' },
  { name: 'Activity', path: '/admin/activity', icon: Activity, permission: 'view_system_logs' },
  { name: 'Settings', path: '/admin/settings', icon: Settings, permission: 'manage_system_settings' },
]

function AdminSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { clerkUser, hasAdminPermission, hasFullAdminAccess } = useUserContext()
  const { signOut } = useClerk()
  const { theme, toggleTheme } = useTheme()

  const filteredNavItems = navItems.filter(item => {
    if (!item.permission) return true
    return hasFullAdminAccess || hasAdminPermission(item.permission as any)
  })

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarContent>
        <SidebarGroup>
          {/* Logo Header */}
          <div className="px-4 py-6 flex items-center gap-2 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-4 group-data-[collapsible=icon]:justify-center">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="group-data-[collapsible=icon]:hidden">
              <h1 className="text-xl font-bold tracking-tight text-primary font-lufga">LearnTrack</h1>
              <p className="text-xs text-muted-foreground">Admin Panel</p>
            </div>
          </div>

          {/* Navigation Menu */}
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredNavItems.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname === item.path ||
                  (item.path !== '/admin' && location.pathname.startsWith(item.path))

                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.name}
                    >
                      <Link to={item.path}>
                        <Icon className="w-4 h-4" />
                        <span>{item.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer with User Menu */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={clerkUser?.imageUrl} alt={clerkUser?.fullName || 'Admin'} />
                    <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                      {clerkUser?.firstName?.[0] || 'A'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{clerkUser?.fullName || "Admin"}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {clerkUser?.primaryEmailAddress?.emailAddress}
                    </span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="bottom"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarImage src={clerkUser?.imageUrl} alt={clerkUser?.fullName || 'Admin'} />
                      <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                        {clerkUser?.firstName?.[0] || 'A'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{clerkUser?.fullName || "Admin"}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {clerkUser?.primaryEmailAddress?.emailAddress}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={toggleTheme}>
                    {theme === "dark" ? (
                      <>
                        <Sun className="mr-2 h-4 w-4" />
                        Light Mode
                      </>
                    ) : (
                      <>
                        <Moon className="mr-2 h-4 w-4" />
                        Dark Mode
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to App
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

export function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  // Get current page title for breadcrumb
  const getCurrentPageTitle = () => {
    const currentItem = navItems.find(item => item.path === location.pathname)
    return currentItem?.name || 'Admin'
  }

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset className="bg-background">
        {/* Header with breadcrumb */}
        <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-card px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="#" onClick={() => navigate('/admin')}>
                  Admin
                </BreadcrumbLink>
              </BreadcrumbItem>
              {location.pathname !== '/admin' && (
                <>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{getCurrentPageTitle()}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}


