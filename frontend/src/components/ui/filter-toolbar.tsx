import { cn } from "@/lib/utils"

interface FilterToolbarProps {
  children: React.ReactNode
  className?: string
}

export function FilterToolbar({ children, className }: FilterToolbarProps) {
  return (
    <div className={cn("flex flex-col sm:flex-row items-start sm:items-center gap-3", className)}>
      {children}
    </div>
  )
}
