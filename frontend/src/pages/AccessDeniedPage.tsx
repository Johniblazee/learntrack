/**
 * AccessDeniedPage - 403 Forbidden Error Page
 *
 * Displays when users attempt to access resources they don't have permission for.
 * Provides helpful guidance on how to proceed.
 */
import { useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useAuth, useUser } from "@clerk/clerk-react"
import { ShieldX, ArrowLeft, Home, LayoutDashboard, LogIn, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface AccessDeniedPageProps {
  /** Custom title for the error page */
  title?: string
  /** Custom message explaining why access was denied */
  message?: string
  /** The resource or action that was denied */
  resource?: string
  /** Required role to access the resource */
  requiredRole?: string
}

export default function AccessDeniedPage({
  title = "Access Denied",
  message = "You don't have permission to access this page.",
  resource,
  requiredRole,
}: AccessDeniedPageProps) {
  const navigate = useNavigate()
  const { isSignedIn, signOut } = useAuth()
  const { user } = useUser()

  // Set document title and meta tags for SEO
  useEffect(() => {
    // Store original title
    const originalTitle = document.title

    // Set 403-specific title
    document.title = "Access Denied | LearnTrack"

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

  const handleSignOut = async () => {
    await signOut()
    navigate("/sign-in")
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-lg text-center shadow-lg border-0">
        <CardHeader className="pb-4">
          {/* 403 Icon */}
          <div className="mx-auto mb-4">
            <div className="w-24 h-24 rounded-full bg-gradient-to-r from-red-100 to-orange-100 dark:from-red-900/30 dark:to-orange-900/30 flex items-center justify-center">
              <ShieldX className="w-12 h-12 text-red-500" />
            </div>
          </div>
          
          <div className="text-5xl font-bold text-red-500 mb-2">403</div>
          
          <CardTitle className="text-2xl font-bold text-foreground">
            {title}
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground mt-2">
            {message}
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Context information */}
          <div className="bg-muted rounded-lg p-4 text-left space-y-2">
            {isSignedIn && user && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="w-4 h-4" />
                <span>Signed in as: <strong>{user.primaryEmailAddress?.emailAddress}</strong></span>
              </div>
            )}
            
            {resource && (
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">Requested resource:</span> {resource}
              </div>
            )}
            
            {requiredRole && (
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">Required role:</span> {requiredRole}
              </div>
            )}
          </div>

          {/* Suggestions */}
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium">What you can do:</p>
            <ul className="list-disc list-inside space-y-1 text-left">
              <li>Contact your administrator for access</li>
              <li>Sign in with a different account</li>
              <li>Return to a page you have access to</li>
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
            
            {isSignedIn ? (
              <>
                <Button
                  asChild
                  className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
                >
                  <Link to="/dashboard" className="flex items-center gap-2">
                    <LayoutDashboard className="w-4 h-4" />
                    Go to Dashboard
                  </Link>
                </Button>
                
                <Button
                  variant="secondary"
                  onClick={handleSignOut}
                  className="flex items-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  Sign in as Different User
                </Button>
              </>
            ) : (
              <Button
                asChild
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
              >
                <Link to="/sign-in" className="flex items-center gap-2">
                  <LogIn className="w-4 h-4" />
                  Sign In
                </Link>
              </Button>
            )}
          </div>

          {/* Home link */}
          <div className="pt-2">
            <Link 
              to="/" 
              className="text-sm text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 flex items-center justify-center gap-1"
            >
              <Home className="w-4 h-4" />
              Return to Homepage
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

