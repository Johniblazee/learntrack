import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth, useUser, SignIn, SignUp } from '@clerk/clerk-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingState } from '@/components/ui/loading-state'
import { toast } from '@/contexts/ToastContext'
import { CheckCircle, XCircle, UserPlus, Mail } from 'lucide-react'
import { useApiClient } from '@/lib/api-client'

interface InvitationDetails {
  valid: boolean
  invitation?: {
    id: string
    invitee_email: string
    invitee_name?: string
    role: 'student' | 'parent'
    message?: string
    student_ids?: string[]
  }
  invited_students?: Array<{
    id: string
    name: string
    email: string
  }>
  tutor_name?: string
  tutor_email?: string
  error?: string
}

export default function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { isSignedIn, userId } = useAuth()
  const client = useApiClient()
  const { user } = useUser()
  
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [invitationDetails, setInvitationDetails] = useState<InvitationDetails | null>(null)
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [showSignIn, setShowSignIn] = useState(false)
  const [showSignUp, setShowSignUp] = useState(false)

  useEffect(() => {
    if (token) {
      verifyInvitation()
    }
  }, [token])

  useEffect(() => {
    // If user just signed in and we have valid invitation, auto-accept
    const requiresParentSelection =
      invitationDetails?.invitation?.role === 'parent' &&
      (invitationDetails.invited_students?.length || 0) > 0

    if (isSignedIn && invitationDetails?.valid && !accepting && !requiresParentSelection) {
      handleAcceptInvitation()
    }
  }, [accepting, invitationDetails, isSignedIn])

  useEffect(() => {
    if (invitationDetails?.invitation?.role === 'parent') {
      setSelectedStudentIds((invitationDetails.invited_students || []).map((student) => student.id))
    } else {
      setSelectedStudentIds([])
    }
  }, [invitationDetails])

  const verifyInvitation = async () => {
    try {
      setLoading(true)

      const response = await client.get(`/invitations/verify/${token}`)

      if (response.error) throw new Error(response.error)

      const data = response.data
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

      const response = await client.post('/invitations/accept', {
        token,
        clerk_id: userId,
        email: user.primaryEmailAddress?.emailAddress || '',
        name: user.fullName || user.firstName || 'User',
        selected_student_ids: selectedStudentIds,
      })

      if (response.error) throw new Error(response.error)

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

  const toggleSelectedStudent = (studentId: string) => {
    setSelectedStudentIds((previous) =>
      previous.includes(studentId)
        ? previous.filter((id) => id !== studentId)
        : [...previous, studentId]
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md shadow-xl">
          <CardContent>
            <LoadingState message="Verifying invitation..." size="xl" className="py-12" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!invitationDetails?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-md shadow-xl border-0 bg-card">
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
    const invitationRedirectUrl = `/accept-invitation/${token}`

    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <div className="w-full max-w-md space-y-6">
          <Card className="shadow-xl border-0 bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <UserPlus className="w-6 h-6 text-purple-600" />
                Accept Invitation
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                You've been invited by {invitationDetails.tutor_name} to join as a {invitationDetails.invitation?.role}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-purple-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Invited Email</p>
                    <p className="text-sm text-muted-foreground">{invitationDetails.invitation?.invitee_email}</p>
                  </div>
                </div>
              </div>

              {invitationDetails.invitation?.message && (
                <div className="p-4 rounded-lg bg-muted border border-border">
                  <p className="text-sm text-foreground italic">
                    "{invitationDetails.invitation.message}"
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-center">
            {showSignUp ? (
              <SignUp
                routing="hash"
                signInUrl="/sign-in"
                forceRedirectUrl={invitationRedirectUrl}
              />
            ) : (
              <SignIn
                routing="hash"
                forceRedirectUrl={invitationRedirectUrl}
              />
            )}
          </div>

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              {showSignUp ? (
                <>
                  Already have an account?{' '}
                  <button
                    onClick={() => setShowSignUp(false)}
                    className="text-purple-600 hover:text-purple-700 font-semibold transition-colors"
                  >
                    Sign in instead
                  </button>
                </>
              ) : (
                <>
                  Don't have an account?{' '}
                  <button
                    onClick={() => setShowSignUp(true)}
                    className="text-purple-600 hover:text-purple-700 font-semibold transition-colors"
                  >
                    Sign up
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (accepting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md shadow-xl">
          <CardContent>
            <LoadingState message="Creating your account..." size="xl" className="py-12" />
          </CardContent>
        </Card>
      </div>
    )
  }

  const requiresParentSelection =
    invitationDetails?.invitation?.role === 'parent' &&
    (invitationDetails.invited_students?.length || 0) > 0

  if (isSignedIn && invitationDetails?.valid && requiresParentSelection) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-xl shadow-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <UserPlus className="w-6 h-6 text-purple-600" />
              Choose Linked Students
            </CardTitle>
            <CardDescription>
              Select which invited students should be linked to your parent account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 rounded-lg border border-border p-4">
              {(invitationDetails.invited_students || []).map((student) => (
                <label
                  key={student.id}
                  className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox
                    checked={selectedStudentIds.includes(student.id)}
                    onCheckedChange={() => toggleSelectedStudent(student.id)}
                  />
                  <div>
                    <p className="font-medium text-foreground">{student.name}</p>
                    <p className="text-sm text-muted-foreground">{student.email}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => navigate('/')}>Cancel</Button>
              <Button onClick={handleAcceptInvitation} disabled={selectedStudentIds.length === 0}>
                Accept Invitation
              </Button>
            </div>
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

