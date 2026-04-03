import { SignUp } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'

export default function SignUpPage() {

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Image Section */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-background to-card overflow-hidden">
        {/* Background Image */}
        <div
          className="absolute inset-0 bg-cover bg-center opacity-80"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=2070&auto=format&fit=crop')`,
          }}
        />

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/40 to-black/60" />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center w-full px-12 text-white">
          <h1 className="text-5xl font-bold mb-4 text-center leading-tight">
            Your Journey to Knowledge<br />Starts Here.
          </h1>
          <p className="text-lg text-white/90 text-center max-w-md">
            LearnTrack empowers tutors, students, and parents with personalized learning and AI-powered tools.
          </p>
        </div>
      </div>

      {/* Right Side - Sign Up Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-white dark:bg-[#1a1a1a] px-6 py-12">
        <div className="w-full max-w-md">
          {/* Logo and Title */}
          <div className="mb-8">
            <h3 className="text-3xl font-bold text-foreground mb-2">Create Your Account</h3>
          </div>

          {/* Clerk Sign Up Component with Custom Styling */}
          <SignUp
            routing="path"
            path="/sign-up"
            fallbackRedirectUrl="/onboarding/teacher"
            signInUrl="/sign-in"
            appearance={{
              variables: {
                colorBackground: '#ffffff',
                colorInputBackground: '#ffffff',
                colorInputText: '#111827',
                colorText: '#111827',
                colorTextSecondary: '#6b7280',
                colorPrimary: '#C8A882',
                borderRadius: '0.5rem',
              },
              elements: {
                rootBox: "w-full",
                card: "shadow-none bg-transparent",
                headerTitle: "hidden",
                headerSubtitle: "hidden",
                socialButtonsBlockButton: "bg-background border-0 hover:bg-muted transition-colors text-sm font-semibold rounded-lg py-3",
                socialButtonsBlockButtonText: "text-foreground font-semibold",
                socialButtonsBlockButtonArrow: "hidden",
                dividerLine: "bg-border",
                dividerText: "text-muted-foreground text-xs uppercase",
                formButtonPrimary: "bg-[#C8A882] hover:bg-[#B89872] text-foreground font-semibold py-3 rounded-lg transition-colors shadow-sm normal-case",
                formFieldInput: "border-0 rounded-lg px-4 py-3 bg-card text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-[#C8A882] focus:border-transparent transition-all shadow-sm",
                formFieldLabel: "text-foreground font-medium mb-2 text-sm",
                footerActionLink: "text-[#C8A882] hover:text-[#B89872] font-medium",
                identityPreviewText: "text-foreground",
                identityPreviewEditButton: "text-[#C8A882] hover:text-[#B89872]",
                formFieldInputShowPasswordButton: "text-muted-foreground hover:text-foreground",
                formHeaderTitle: "hidden",
                formHeaderSubtitle: "hidden",
                footer: "hidden",
                formFieldRow: "gap-4",
                formFieldAction: "text-[#C8A882] hover:text-[#B89872] text-sm font-medium",
                // Hide the "Continue with Clerk" button
                socialButtonsProviderIcon__clerk: "hidden",
                socialButtonsBlockButton__clerk: "hidden",
                // Ensure form fields are visible
                form: "space-y-5",
                formField: "space-y-2",
              },
              layout: {
                socialButtonsPlacement: "top",
                socialButtonsVariant: "blockButton",
                showOptionalFields: true,
              },
            }}
          />

          {/* Sign In Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link
                to="/sign-in"
                className="text-[#C8A882] hover:text-[#B89872] font-semibold transition-colors"
              >
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
