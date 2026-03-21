import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatsCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  iconClassName?: string
  iconColor?: string
  className?: string
}

export function StatsCard({ icon: Icon, label, value, iconClassName, iconColor, className }: StatsCardProps) {
  return (
    <Card className={cn("border-0 shadow-sm bg-card", className)}>
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center bg-primary/10", iconClassName)}>
            <Icon className={cn("h-5 w-5 text-primary", iconColor)} />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
