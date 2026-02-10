import { useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Header } from "@/components/ui/header"
import { Users, ArrowLeft } from "lucide-react"

export default function StudentsPage() {
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
          <Users className="h-8 w-8 text-purple-600 mr-3" />
          <h1 className="text-3xl font-bold text-foreground">Student Management</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Student Directory</CardTitle>
            <CardDescription>Manage your students and track their progress.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              The student management system will be available here. View and manage all your students in one place.
            </p>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>• View all enrolled students</p>
              <p>• Track individual progress</p>
              <p>• Manage student groups and classes</p>
              <p>• Send notifications to students</p>
              <p>• Generate student reports</p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
