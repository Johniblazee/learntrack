import { useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Header } from "@/components/ui/header"
import { FileText, ArrowLeft } from "lucide-react"

export default function AssignmentsPage() {
  const { isLoaded, isSignedIn } = useUser()
  const navigate = useNavigate()

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      navigate('/sign-in')
    }
  }, [isLoaded, isSignedIn, navigate])

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate('/dashboard')}
            className="mr-4 transition-all duration-300 hover:scale-105 motion-reduce:hover:scale-100"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          <FileText className="h-8 w-8 text-purple-600 mr-3" />
          <h1 className="text-3xl font-bold text-foreground">Manage Assignments</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Coming Soon</CardTitle>
            <CardDescription>This feature is under construction.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              The assignment management functionality will be available here shortly. You'll be able to create, assign, and review assignments.
            </p>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>• Create and customize assignments</p>
              <p>• Set due dates and time limits</p>
              <p>• Assign to specific students or groups</p>
              <p>• Review and grade submissions</p>
              <p>• Generate performance reports</p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
