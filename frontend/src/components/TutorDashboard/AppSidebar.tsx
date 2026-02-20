import { LayoutDashboard, Users, FileText, BookOpen, Settings, ChevronRight, UserPlus, MessageSquare, Mail, Brain, CheckSquare, Library, FolderOpen, Calendar, ClipboardList, GraduationCap, LogOut, Moon, Sun, Layers } from "lucide-react"

import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import { useUser, useClerk } from "@clerk/clerk-react"
import { useTheme } from "@/contexts/ThemeContext"
import { useUserContext } from "@/contexts/UserContext"
import { useImpersonation } from "@/contexts/ImpersonationContext"
import { useNavigate, Link } from "react-router-dom"

interface AppSidebarProps {
  activeView: string
  onViewChange: (view: string) => void
}

const menuItems = [
  {
    title: "Dashboard",
    icon: LayoutDashboard,
    view: "overview",
  },
  {
    title: "Students",
    icon: Users,
    items: [
      {
        title: "All Students",
        icon: Users,
        view: "all-students",
      },
      {
        title: "Invitations",
        icon: UserPlus,
        view: "invitations",
      },
      {
        title: "Groups",
        icon: Users,
        view: "groups",
      },
    ],
  },
  {
    title: "Content",
    icon: BookOpen,
    items: [
      {
        title: "Question Generator",
        icon: Brain,
        view: "ai-generator",
      },
      {
        title: "Review Questions",
        icon: CheckSquare,
        view: "review-questions",
      },
      {
        title: "Question Bank",
        icon: Library,
        view: "question-bank",
      },
      {
        title: "Materials",
        icon: FolderOpen,
        view: "resources",
      },
      {
        title: "Subjects",
        icon: BookOpen,
        view: "subjects",
      },
    ],
  },
  {
    title: "Assignments",
    icon: FileText,
    items: [
      {
        title: "Active Assignments",
        icon: Calendar,
        view: "active-assignments",
      },
      {
        title: "Create New",
        icon: ClipboardList,
        view: "create-new",
      },
      {
        title: "Templates",
        icon: FileText,
        view: "templates",
      },
      {
        title: "Grading",
        icon: GraduationCap,
        view: "grading",
      },
    ],
  },
  {
    title: "Messages",
    icon: MessageSquare,
    items: [
      {
        title: "Conversations",
        icon: MessageSquare,
        view: "chats",
      },
      {
        title: "Emails",
        icon: Mail,
        view: "emails",
      },
    ],
  },
]

export function AppSidebar({ activeView, onViewChange }: AppSidebarProps) {
  const { user } = useUser()
  const { backendUser } = useUserContext()
  const { isImpersonating } = useImpersonation()
  const { signOut } = useClerk()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  void onViewChange

  const actorName = user?.fullName || user?.firstName || "User"
  const impersonatedName = backendUser?.name && backendUser.name !== "Unknown User" ? backendUser.name : actorName
  const displayName = isImpersonating ? impersonatedName : actorName

  const actorEmail = user?.primaryEmailAddress?.emailAddress || ""
  const impersonatedEmail = backendUser?.email || actorEmail
  const displayEmail = isImpersonating ? impersonatedEmail : actorEmail
  const initials =
    displayName
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((token) => token[0]?.toUpperCase() || "")
      .join("") || "U"
  const showClerkAvatar = !isImpersonating || backendUser?.clerk_id === user?.id

  const handleSignOut = async () => {
    await signOut()
    navigate("/")
  }

  const handleSettings = () => {
    navigate("/settings")
  }

  // Map view names to routes
  const getRouteForView = (view: string): string => {
    const viewToRoute: Record<string, string> = {
      'overview': '/dashboard',
      'all-students': '/dashboard/students',
      'invitations': '/dashboard/invitations',
      'groups': '/dashboard/groups',
      'ai-generator': '/dashboard/content/generator',
      'review-questions': '/dashboard/content/review',
      'question-bank': '/dashboard/content/bank',
      'resources': '/dashboard/content/materials',
      'subjects': '/dashboard/content/subjects',
      'active-assignments': '/dashboard/assignments',
      'create-new': '/dashboard/assignments/create',
      'templates': '/dashboard/assignments/templates',
      'grading': '/dashboard/assignments/grading',
      'chats': '/dashboard/messages/chats',
      'emails': '/dashboard/messages/emails',
    }
    return viewToRoute[view] || '/dashboard'
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarContent>
        <SidebarGroup>
          <div className="px-4 py-6 flex items-center gap-2 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-4 group-data-[collapsible=icon]:justify-center">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <Layers className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-primary font-lufga group-data-[collapsible=icon]:hidden">
              LearnTrack
            </h1>
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                // Menu item with submenu
                if (item.items) {
                  return (
                    <Collapsible
                      key={item.title}
                      asChild
                      defaultOpen={item.items.some((subItem) => subItem.view === activeView)}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton tooltip={item.title}>
                            {item.icon && <item.icon />}
                            <span>{item.title}</span>
                            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.items.map((subItem) => (
                              <SidebarMenuSubItem key={subItem.title}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={activeView === subItem.view}
                                >
                                  <Link to={getRouteForView(subItem.view)}>
                                    {subItem.icon && <subItem.icon />}
                                    <span>{subItem.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  )
                }

                // Single menu item
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={activeView === item.view}
                      tooltip={item.title}
                    >
                      <Link to={item.view ? getRouteForView(item.view) : '#'}>
                        {item.icon && <item.icon />}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  tooltip="Profile"
                >
                  <Avatar className="h-8 w-8 rounded-lg group-data-[collapsible=icon]:mx-auto">
                    {showClerkAvatar && <AvatarImage src={user?.imageUrl} alt={displayName} />}
                    <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold">{displayName}</span>
                    <span className="truncate text-xs">{displayEmail}</span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="top"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      {showClerkAvatar && <AvatarImage src={user?.imageUrl} alt={displayName} />}
                      <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{displayName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {displayEmail}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={handleSettings}>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
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
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

