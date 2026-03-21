/**
 * NotFoundPage - 404 Error Page
 *
 * Displays a user-friendly 404 error page when users navigate to non-existent routes.
 * Provides navigation options to help users find their way back.
 */
import { useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { Home, ArrowLeft, Search, LayoutDashboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function NotFoundPage() {
  const navigate = useNavigate()
  const { isSignedIn } = useAuth()

  // Set document title and meta tags for SEO
  useEffect(() => {
    // Store original title
    const originalTitle = document.title

    // Set 404-specific title
    document.title = "Page Not Found | LearnTrack"

    // Add noindex meta tag to prevent indexing of error pages
    let metaRobots = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null
    const hadOriginalMeta = !!metaRobots
    const originalContent = metaRobots?.getAttribute('content') || ''

    if (!metaRobots) {
      metaRobots = document.createElement('meta')
      metaRobots.name = 'robots'
      document.head.appendChild(metaRobots)
    }
    metaRobots.content = 'noindex, nofollow'

    // Cleanup on unmount
    return () => {
      document.title = originalTitle
      if (metaRobots) {
        if (hadOriginalMeta) {
          metaRobots.content = originalContent
        } else {
          metaRobots.remove()
        }
      }
    }
  }, [])

  const handleGoBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate("/")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-lg text-center shadow-lg border-0">
        <CardHeader className="pb-4">
          {/* 404 Illustration */}
          <div className="relative mx-auto mb-6">
            <div className="text-[120px] font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent leading-none">
              404
            </div>
            <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-32 h-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full opacity-50" />
          </div>
          
          <CardTitle className="text-2xl font-bold text-foreground">
            Page Not Found
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground mt-2">
            Oops! The page you're looking for doesn't exist or has been moved.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Helpful suggestions */}
          <div className="bg-muted rounded-lg p-4 text-left">
            <p className="text-sm font-medium text-foreground mb-2">
              Here are some helpful links:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <span className="w-1 h-1 bg-purple-500 rounded-full" />
                <span>Check the URL for typos</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1 h-1 bg-purple-500 rounded-full" />
                <span>Go back to the previous page</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1 h-1 bg-purple-500 rounded-full" />
                <span>Visit our homepage to start fresh</span>
              </li>
            </ul>
          </div>

          {/* Navigation buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              variant="outline"
              onClick={handleGoBack}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </Button>
            
            <Button
              asChild
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
            >
              <Link to="/" className="flex items-center gap-2">
                <Home className="w-4 h-4" />
                Go to Homepage
              </Link>
            </Button>

            {isSignedIn && (
              <Button
                asChild
                variant="secondary"
                className="flex items-center gap-2"
              >
                <Link to="/dashboard">
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Link>
              </Button>
            )}
          </div>

          {/* Search suggestion */}
          <div className="text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Search className="w-4 h-4" />
            <span>Looking for something specific? Try using the navigation menu.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

