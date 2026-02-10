import { useNavigate } from "react-router-dom"
import { useUser } from "@clerk/clerk-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { GraduationCap } from "lucide-react"

interface HeaderProps {
  showNavigation?: boolean
}

export function Header({ showNavigation = true }: HeaderProps) {
  const { isSignedIn, user } = useUser()
  const navigate = useNavigate()

  const handleGetStarted = () => {
    navigate('/sign-up')
  }

  const handleSignIn = () => {
    navigate('/sign-in')
  }

  return (
    <header className="relative bg-background border-b border-border/60 sticky top-0 z-50">
      {/* Subtle Academic Pattern in Header */}
      <div className="absolute inset-0 opacity-[0.015] dark:opacity-[0.008]">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(90deg, #6366f1 0.5px, transparent 0.5px),
            linear-gradient(180deg, #6366f1 0.5px, transparent 0.5px)
          `,
          backgroundSize: '40px 40px'
        }}></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
              <GraduationCap className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground">LearnTrack</span>
          </div>

          {/* Navigation */}
          {showNavigation && (
            <nav className="hidden md:flex space-x-8">
              <a href="#" className="relative text-muted-foreground hover:text-primary transition-all duration-300 motion-reduce:transition-none hover:scale-105 motion-reduce:hover:scale-100 group">
                <span className="relative z-10">Features</span>
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 motion-reduce:transition-none origin-left"></span>
              </a>
              <a href="#" className="relative text-muted-foreground hover:text-primary transition-all duration-300 motion-reduce:transition-none hover:scale-105 motion-reduce:hover:scale-100 group">
                <span className="relative z-10">Solutions</span>
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 motion-reduce:transition-none origin-left"></span>
              </a>
              <a href="#" className="relative text-muted-foreground hover:text-primary transition-all duration-300 motion-reduce:transition-none hover:scale-105 motion-reduce:hover:scale-100 group">
                <span className="relative z-10">Pricing</span>
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 motion-reduce:transition-none origin-left"></span>
              </a>
              <a href="#" className="relative text-muted-foreground hover:text-primary transition-all duration-300 motion-reduce:transition-none hover:scale-105 motion-reduce:hover:scale-100 group">
                <span className="relative z-10">About</span>
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 motion-reduce:transition-none origin-left"></span>
              </a>
            </nav>
          )}

          {/* Auth Buttons */}
          <div className="flex items-center space-x-4">
            <ThemeToggle />

            {isSignedIn ? (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-muted-foreground">
                  Welcome, {user?.firstName || user?.emailAddresses[0]?.emailAddress}
                </span>
                <Button
                  onClick={() => navigate('/dashboard')}
                  variant="outline"
                  className="transition-all duration-300 hover:scale-105 motion-reduce:hover:scale-100"
                >
                  Dashboard
                </Button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleSignIn}
                  className="text-muted-foreground hover:text-primary transition-all duration-300 motion-reduce:transition-none hover:scale-105 motion-reduce:hover:scale-100 px-3 py-2 rounded-lg hover:bg-primary/5"
                >
                  Sign In
                </button>
                <button
                  onClick={handleGetStarted}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-all duration-300 hover:scale-105 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:scale-100 transform hover:-translate-y-0.5 motion-reduce:hover:translate-y-0"
                >
                  Get Started
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
