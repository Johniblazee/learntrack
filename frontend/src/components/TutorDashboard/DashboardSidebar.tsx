import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Brain, Home, Users, FileText, BookOpen, ChevronDown, ChevronRight } from "lucide-react"

interface DashboardSidebarProps {
  activeView: string
  onViewChange: (view: string) => void
}

export function DashboardSidebar({ activeView, onViewChange }: DashboardSidebarProps) {
  // Navigation items
  const navItems = [
    {
      title: "Dashboard",
      icon: Home,
      items: [
        { title: "Overview", icon: ChevronRight }
      ]
    },
    {
      title: "Students",
      icon: Users,
      items: [
        { title: "All Students", icon: ChevronRight },
        { title: "Invitations", icon: ChevronRight },
        { title: "Performance", icon: ChevronRight },
        { title: "Attendance", icon: ChevronRight },
        { title: "Groups", icon: ChevronRight }
      ]
    },
    {
      title: "Assignments",
      icon: FileText,
      items: [
        { title: "Active Assignments", icon: ChevronRight },
        { title: "Create New", icon: ChevronRight },
        { title: "Templates", icon: ChevronRight },
        { title: "Grading", icon: ChevronRight }
      ]
    },
    {
      title: "Content",
      icon: BookOpen,
      items: [
        { title: "Question Bank", icon: ChevronRight },
        { title: "Review Questions", icon: ChevronRight },
        { title: "Subjects", icon: ChevronRight },
        { title: "AI Generator", icon: ChevronRight },
        { title: "Resources", icon: ChevronRight }
      ]
    }
  ]

  return (
    <Sidebar className="border-r border-border">
      <SidebarContent>
        {/* Logo Header */}
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
              <Brain className="h-5 w-5 text-white" />
            </div>
            <div className="group-data-[collapsible=icon]:hidden">
              <h1 className="font-semibold text-sidebar-foreground">LearnTrack</h1>
              <p className="text-xs text-sidebar-foreground/70">Tutor Portal</p>
            </div>
          </div>
        </div>

        {/* Navigation Groups */}
        {navItems.map((group, idx) => (
          <Collapsible key={idx} defaultOpen={idx === 0} className="group/collapsible">
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-lg transition-all duration-200">
                  <div className="flex items-center space-x-3">
                    <group.icon className="h-4 w-4" />
                    <span className="group-data-[collapsible=icon]:hidden">{group.title}</span>
                  </div>
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180 group-data-[collapsible=icon]:hidden" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item, itemIdx) => {
                      const viewKey = item.title.toLowerCase().replace(" ", "-")
                      const isActive = activeView === viewKey
                      
                      return (
                        <SidebarMenuItem key={itemIdx}>
                          <SidebarMenuButton
                            onClick={() => onViewChange(viewKey)}
                            className={`text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-all duration-200 ${
                              isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : ''
                            }`}
                          >
                            <span className="ml-6 group-data-[collapsible=icon]:ml-0">{item.title}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}

