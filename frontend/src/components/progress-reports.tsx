import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ProgressReports() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Progress Reports</CardTitle>
        <CardDescription>View student progress and performance analytics</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-muted-foreground">Progress reporting functionality coming soon...</p>
        </div>
      </CardContent>
    </Card>
  )
}
