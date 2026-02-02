import { useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Button } from "@/components/ui/button"
import { Header } from "@/components/ui/header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { HelpCircle, ArrowLeft, Sparkles, Database, Plus } from "lucide-react"
import AIQuestionGenerator from "@/components/ai/question-generator"
import QuestionBankManager from "@/components/question-bank-manager"
import { GeneratedQuestion } from "@/hooks/useQuestionGenerator"
import { toast } from "@/contexts/ToastContext"
import { useApiClient } from "@/lib/api-client"

export default function QuestionsPage() {
  const { isLoaded, isSignedIn } = useUser()
  const navigate = useNavigate()
  const client = useApiClient()
  const [activeTab, setActiveTab] = useState("ai-generator")

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      navigate('/sign-in')
    }
  }, [isLoaded, isSignedIn, navigate])

  // Handle adding generated questions to the bank
  const handleQuestionsGenerated = async (questions: GeneratedQuestion[]) => {
    try {
      let addedCount = 0
      
      for (const question of questions) {
        const createData = {
          question_text: question.question_text,
          subject_id: question.subject || '',
          topic: question.topic || '',
          question_type: question.type,
          difficulty: question.difficulty,
          options: question.options,
          correct_answer: question.correct_answer,
          explanation: question.explanation,
          points: 1,
          tags: question.tags || [],
          status: 'active',
        }

        const response = await client.post('/questions/', createData)
        
        if (!response.error) {
          addedCount++
        }
      }

      if (addedCount > 0) {
        toast.success(`Added ${addedCount} question${addedCount !== 1 ? 's' : ''} to your question bank`)
        // Switch to the question bank tab to show the new questions
        setActiveTab("question-bank")
      } else {
        toast.error('Failed to add questions to the bank')
      }
    } catch (err) {
      console.error('Failed to add questions:', err)
      toast.error('Failed to add questions to the bank')
    }
  }

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
          <HelpCircle className="h-8 w-8 text-purple-600 mr-3" />
          <h1 className="text-3xl font-bold text-foreground">Question Bank</h1>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="ai-generator" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI Generator
            </TabsTrigger>
            <TabsTrigger value="question-bank" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              My Questions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ai-generator" className="space-y-6">
            <AIQuestionGenerator onQuestionsGenerated={handleQuestionsGenerated} />
          </TabsContent>

          <TabsContent value="question-bank">
            <QuestionBankManager />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
