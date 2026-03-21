import { cn } from "@/lib/utils"

interface PageShellProps {
  children: React.ReactNode
  className?: string
}

export function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={cn("max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6", className)}>
      {children}
    </div>
  )
}
