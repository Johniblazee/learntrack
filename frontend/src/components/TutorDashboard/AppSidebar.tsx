import { LayoutDashboard, Users, FileText, BookOpen, ChevronRight, UserPlus, MessageSquare, Mail, Brain, CheckSquare, Library, FolderOpen, Calendar, ClipboardList, GraduationCap, Layers } from "lucide-react"

import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Link } from "react-router-dom"

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
  void onViewChange

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

    </Sidebar>
  )
}

