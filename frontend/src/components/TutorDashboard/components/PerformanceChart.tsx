import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Line, LineChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useState } from "react"
import { usePerformanceChart } from "@/hooks/useQueries"
import { BarChart3 } from "lucide-react"

const chartConfig = {
  performance: {
    label: "Performance",
    color: "#C8A882",
  },
}

// Map period selection to days
const periodToDays: Record<string, number> = {
  "7days": 7,
  "30days": 30,
  "90days": 90,
}

export function PerformanceChart() {
  const [selectedPeriod, setSelectedPeriod] = useState("30days")
  const days = periodToDays[selectedPeriod] || 30

  const { data: chartData, isLoading } = usePerformanceChart(days)

  // Get the description text based on selected period
  const getDescription = () => {
    switch (selectedPeriod) {
      case "7days":
        return "Overall progress in the last 7 days."
      case "30days":
        return "Overall progress in the last 30 days."
      case "90days":
        return "Overall progress in the last 90 days."
      default:
        return "Overall progress in the last 30 days."
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <Card className="border-0 shadow-sm bg-card h-full flex flex-col">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">Class Performance Trends</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">{getDescription()}</CardDescription>
            </div>
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod} disabled>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="pb-4 flex-1 flex items-center justify-center">
          <div className="animate-pulse w-full h-full min-h-[200px] bg-muted rounded"></div>
        </CardContent>
      </Card>
    )
  }

  // Empty state
  if (!chartData || chartData.length === 0) {
    return (
      <Card className="border-0 shadow-sm bg-card h-full flex flex-col">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">Class Performance Trends</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">{getDescription()}</CardDescription>
            </div>
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7days">Last 7 Days</SelectItem>
                <SelectItem value="30days">Last 30 Days</SelectItem>
                <SelectItem value="90days">Last 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="pb-4 flex-1 flex items-center justify-center">
          <div className="text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-muted-foreground">No performance data yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Chart will populate as students complete assignments
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 shadow-sm bg-card h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold text-foreground">Class Performance Trends</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">{getDescription()}</CardDescription>
          </div>
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7days">Last 7 Days</SelectItem>
              <SelectItem value="30days">Last 30 Days</SelectItem>
              <SelectItem value="90days">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="pb-4 flex-1 flex items-center">
        <ChartContainer config={chartConfig} className="h-full w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="0"
                stroke="hsl(var(--border))"
                vertical={false}
                opacity={0.3}
              />
              <XAxis
                dataKey="period"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
              />
              <ChartTooltip
                content={<ChartTooltipContent />}
                cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
              />
              <Line
                type="natural"
                dataKey="performance"
                stroke="#C8A882"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5, fill: "#C8A882" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

