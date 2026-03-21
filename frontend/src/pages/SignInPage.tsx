import { SignIn } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex">
      {/* Custom styles to override Clerk's input backgrounds */}
      <style>{`
        .cl-input {
          background-color: white !important;
        }
        .dark .cl-input {
          background-color: #1a1a1a !important;
        }
        .cl-formFieldInput {
          background-color: white !important;
        }
        .dark .cl-formFieldInput {
          background-color: #1a1a1a !important;
        }
        input[data-testid="form-field-input"] {
          background-color: white !important;
        }
        .dark input[data-testid="form-field-input"] {
          background-color: #1a1a1a !important;
        }
        .cl-internal-1d5bp5m {
          background-color: white !important;
        }
        .dark .cl-internal-1d5bp5m {
          background-color: #1a1a1a !important;
        }
      `}</style>
      {/* Left Side - Image Section */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-background to-card overflow-hidden">
        {/* Background Image */}
        <div
          className="absolute inset-0 bg-cover bg-center opacity-80"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=2070&auto=format&fit=crop')`,
          }}
        />

        {/* Overlay - Subtle dark overlay for better text readability */}
        <div className="absolute inset-0 bg-gradient-to-br from-black/30 via-black/20 to-black/30" />

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

      {/* Right Side - Sign In Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-white dark:bg-[#1a1a1a] px-6 py-12">
        <div className="w-full max-w-md">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-2">LearnTrack</h2>
            <h3 className="text-3xl font-bold text-foreground mb-2">Welcome Back</h3>
            <p className="text-sm text-muted-foreground">
              Log in to continue your learning adventure
            </p>
          </div>

          {/* Clerk Sign In Component with Custom Styling */}
          <SignIn
            routing="path"
            path="/sign-in"
            fallbackRedirectUrl="/dashboard"
            signUpUrl="/sign-up"
            appearance={{
              variables: {
                colorBackground: 'transparent',
                colorInputBackground: 'transparent',
                colorInputText: '#111827',
                colorText: '#111827',
                colorTextSecondary: '#6b7280',
                colorPrimary: '#5c4a38',
                borderRadius: '0.5rem',
              },
              elements: {
                rootBox: "w-full",
                card: "shadow-none bg-transparent",
                headerTitle: "hidden",
                headerSubtitle: "hidden",
                socialButtonsBlockButton: "bg-transparent border border-input hover:bg-muted transition-colors text-sm font-semibold rounded-lg py-3",
                socialButtonsBlockButtonText: "text-foreground font-semibold",
                socialButtonsBlockButtonArrow: "hidden",
                dividerLine: "bg-border",
                dividerText: "text-muted-foreground text-xs uppercase",
                formButtonPrimary: "bg-[#5c4a38] hover:bg-[#4a3a2a] text-white font-semibold py-3 rounded-lg transition-colors shadow-sm normal-case",
                formFieldInput: "border border-input rounded-lg px-4 py-3 !bg-background text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-[#5c4a38] focus:border-transparent transition-all",
                formFieldInputField: "!bg-background text-foreground",
                formFieldLabel: "text-foreground font-medium mb-2 text-sm",
                footerActionLink: "text-[#5c4a38] hover:text-[#4a3a2a] font-medium",
                identityPreviewText: "text-foreground",
                identityPreviewEditButton: "text-[#5c4a38] hover:text-[#4a3a2a]",
                formFieldInputShowPasswordButton: "text-muted-foreground hover:text-foreground",
                formHeaderTitle: "hidden",
                formHeaderSubtitle: "hidden",
                footer: "hidden",
                formFieldRow: "gap-4",
                formFieldAction: "text-[#5c4a38] hover:text-[#4a3a2a] text-sm font-medium",
                // Hide the "Continue with Clerk" button
                socialButtonsProviderIcon__clerk: "hidden",
                socialButtonsBlockButton__clerk: "hidden",
                // Ensure form fields are visible
                form: "space-y-4",
                formField: "space-y-2",
              },
              layout: {
                socialButtonsPlacement: "bottom",
                socialButtonsVariant: "blockButton",
                showOptionalFields: true,
              },
            }}
          />

          {/* Sign Up Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <Link
                to="/sign-up"
                className="text-[#5c4a38] hover:text-[#4a3a2a] font-semibold transition-colors"
              >
                Sign Up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
