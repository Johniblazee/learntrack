import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth, useUser, SignIn } from '@clerk/clerk-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from '@/contexts/ToastContext'
import { CheckCircle, XCircle, Loader2, UserPlus, Mail } from 'lucide-react'

interface InvitationDetails {
  valid: boolean
  invitation?: {
    id: string
    invitee_email: string
    invitee_name?: string
    role: 'student' | 'parent'
    message?: string
  }
  tutor_name?: string
  tutor_email?: string
  error?: string
}

export default function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { isSignedIn, getToken, userId } = useAuth()
  const { user } = useUser()
  
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [invitationDetails, setInvitationDetails] = useState<InvitationDetails | null>(null)
  const [showSignIn, setShowSignIn] = useState(false)

  useEffect(() => {
    if (token) {
      verifyInvitation()
    }
  }, [token])

  useEffect(() => {
    // If user just signed in and we have valid invitation, auto-accept
    if (isSignedIn && invitationDetails?.valid && !accepting) {
      handleAcceptInvitation()
    }
  }, [isSignedIn, invitationDetails])

  const verifyInvitation = async () => {
    try {
      setLoading(true)
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

      const response = await fetch(`${API_BASE}/invitations/verify/${token}`)
      
      if (!response.ok) throw new Error('Failed to verify invitation')

      const data = await response.json()
      setInvitationDetails(data)

      if (!data.valid) {
        toast.error('Invalid Invitation', {
          description: data.error || 'This invitation is no longer valid'
        })
      }
    } catch (error) {
      console.error('Failed to verify invitation:', error)
      toast.error('Failed to verify invitation')
      setInvitationDetails({
        valid: false,
        error: 'Failed to verify invitation'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAcceptInvitation = async () => {
    if (!isSignedIn || !user || !token) {
      setShowSignIn(true)
      return
    }

    try {
      setAccepting(true)
      const authToken = await getToken()
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

      const response = await fetch(`${API_BASE}/invitations/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          token,
          clerk_id: userId,
          email: user.primaryEmailAddress?.emailAddress || '',
          name: user.fullName || user.firstName || 'User'
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to accept invitation')
      }

      await response.json()

      toast.success('Invitation Accepted!', {
        description: 'Your account has been created successfully'
      })

      // Redirect to dashboard based on role
      setTimeout(() => {
        navigate('/dashboard')
      }, 1500)
    } catch (error: any) {
      console.error('Failed to accept invitation:', error)
      toast.error('Failed to accept invitation', {
        description: error.message || 'Please try again later'
      })
      setAccepting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md shadow-xl">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Verifying invitation...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!invitationDetails?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 p-4">
        <Card className="w-full max-w-md shadow-xl border-0 bg-white dark:bg-slate-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="w-6 h-6" />
              Invalid Invitation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/20">
              <AlertDescription className="text-red-800 dark:text-red-200">
                {invitationDetails?.error || 'This invitation is no longer valid'}
              </AlertDescription>
            </Alert>
            <Button
              onClick={() => navigate('/')}
              className="w-full mt-6 bg-purple-600 hover:bg-purple-700 text-white"
            >
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (showSignIn || !isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 p-4">
        <div className="w-full max-w-md space-y-6">
          <Card className="shadow-xl border-0 bg-white dark:bg-slate-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-white">
                <UserPlus className="w-6 h-6 text-purple-600" />
                Accept Invitation
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-400">
                You've been invited by {invitationDetails.tutor_name} to join as a {invitationDetails.invitation?.role}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-purple-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">Invited Email</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{invitationDetails.invitation?.invitee_email}</p>
                  </div>
                </div>
              </div>

              {invitationDetails.invitation?.message && (
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <p className="text-sm text-slate-700 dark:text-slate-300 italic">
                    "{invitationDetails.invitation.message}"
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-center">
            <SignIn 
              routing="hash"
              signUpUrl="/sign-up"
              afterSignInUrl={`/accept-invitation/${token}`}
            />
          </div>
        </div>
      </div>
    )
  }

  if (accepting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md shadow-xl">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Creating your account...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="w-6 h-6 text-green-600" />
            Invitation Accepted!
          </CardTitle>
          <CardDescription>
            Your account has been created successfully
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20">
            <AlertDescription className="text-green-800 dark:text-green-200">
              Redirecting to your dashboard...
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  )
}

