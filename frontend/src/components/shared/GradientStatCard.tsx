import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { LucideIcon } from "lucide-react"
import { ReactNode } from "react"

export type GradientColor = "purple" | "green" | "blue" | "orange" | "red" | "teal"

interface GradientStatCardProps {
  title: string
  value: string | number | ReactNode
  subtitle?: string
  icon: LucideIcon
  gradient: GradientColor
  loading?: boolean
}

const gradientStyles: Record<GradientColor, { bg: string; titleColor: string; subtitleColor: string; iconColor: string }> = {
  purple: {
    bg: "bg-gradient-to-br from-purple-500 to-purple-600",
    titleColor: "text-purple-100",
    subtitleColor: "text-purple-100",
    iconColor: "text-purple-200",
  },
  green: {
    bg: "bg-gradient-to-br from-green-500 to-green-600",
    titleColor: "text-green-100",
    subtitleColor: "text-green-100",
    iconColor: "text-green-200",
  },
  blue: {
    bg: "bg-gradient-to-br from-blue-500 to-blue-600",
    titleColor: "text-blue-100",
    subtitleColor: "text-blue-100",
    iconColor: "text-blue-200",
  },
  orange: {
    bg: "bg-gradient-to-br from-orange-500 to-orange-600",
    titleColor: "text-orange-100",
    subtitleColor: "text-orange-100",
    iconColor: "text-orange-200",
  },
  red: {
    bg: "bg-gradient-to-br from-red-500 to-red-600",
    titleColor: "text-red-100",
    subtitleColor: "text-red-100",
    iconColor: "text-red-200",
  },
  teal: {
    bg: "bg-gradient-to-br from-teal-500 to-teal-600",
    titleColor: "text-teal-100",
    subtitleColor: "text-teal-100",
    iconColor: "text-teal-200",
  },
}

export function GradientStatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  gradient,
  loading = false,
}: GradientStatCardProps) {
  const styles = gradientStyles[gradient]

  return (
    <Card className={`${styles.bg} text-white border-0 shadow-lg`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className={`${styles.titleColor} text-sm font-medium`}>{title}</p>
            <p className="text-3xl font-bold">
              {loading ? <Skeleton className="h-9 w-16 bg-white/20" /> : value}
            </p>
            {subtitle && (
              <p className={`${styles.subtitleColor} text-xs mt-1`}>{subtitle}</p>
            )}
          </div>
          <Icon className={`w-8 h-8 ${styles.iconColor}`} />
        </div>
      </CardContent>
    </Card>
  )
}

// Export for convenience - a grid container for stat cards
interface StatCardGridProps {
  children: ReactNode
  columns?: 2 | 3 | 4
}

export function StatCardGrid({ children, columns = 4 }: StatCardGridProps) {
  const gridCols = {
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  }

  return (
    <div className={`grid ${gridCols[columns]} gap-6`}>
      {children}
    </div>
  )
}

