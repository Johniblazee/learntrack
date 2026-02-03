"use client"

import { useState, useCallback } from 'react'
import { useQuestionGenerator, GenerationConfig, GeneratedQuestion } from '@/hooks/useQuestionGenerator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Sparkles,
  Send,
  RotateCcw,
  BookOpen,
  Brain,
  CheckCircle,
  AlertCircle,
  FileText,
  Download,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react'

// AI Components
import {
  InlineCitation,
  InlineCitationText,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationCarousel,
  InlineCitationCarouselHeader,
  InlineCitationCarouselContent,
  InlineCitationCarouselItem,
  InlineCitationCarouselPrev,
  InlineCitationCarouselNext,
  InlineCitationCarouselIndex,
  InlineCitationSource,
  SourceMaterial,
} from '@/components/ai/inline-citation'

import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ThinkingStep,
} from '@/components/ai/chain-of-thought'

import {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactDescription,
  ArtifactActions,
  ArtifactAction,
  ArtifactContent,
} from '@/components/ai/artifact'

import {
  Actions,
  ActionCopy,
  ActionRegenerate,
  ActionThumbsUp,
  ActionThumbsDown,
} from '@/components/ai/actions'

import { DIFFICULTIES, DIFFICULTY_LABELS, QUESTION_TYPES, QUESTION_TYPE_LABELS } from '@/lib/constants'

// Difficulty badge color helper
const getDifficultyColor = (difficulty: string) => {
  switch (difficulty.toLowerCase()) {
    case DIFFICULTIES.EASY:
      return 'bg-emerald-500/20 text-emerald-400 border-0 font-medium px-3 py-1'
    case DIFFICULTIES.MEDIUM:
      return 'bg-amber-500/20 text-amber-400 border-0 font-medium px-3 py-1'
    case DIFFICULTIES.HARD:
      return 'bg-red-500/20 text-red-400 border-0 font-medium px-3 py-1'
    default:
      return 'bg-muted text-muted-foreground border-0 px-3 py-1'
  }
}

export interface AIQuestionGeneratorProps {
  onQuestionsGenerated?: (questions: GeneratedQuestion[]) => void
}

export default function AIQuestionGenerator({ onQuestionsGenerated }: AIQuestionGeneratorProps) {
  // Form state
  const [prompt, setPrompt] = useState('')
  const [subject, setSubject] = useState('')
  const [topic, setTopic] = useState('')
  const [questionCount, setQuestionCount] = useState(5)
  const [difficulty, setDifficulty] = useState<string>(DIFFICULTIES.MEDIUM)
  const [questionType, setQuestionType] = useState<string>(QUESTION_TYPES.MULTIPLE_CHOICE)
  
  // Question generator hook
  const {
    isGenerating,
    thinkingSteps,
    sources,
    questions,
    currentContent,
    error,
    progress,
    startGeneration,
    stopGeneration,
    clearResults,
  } = useQuestionGenerator()

  // Handle generation start
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return

    const config: GenerationConfig = {
      prompt: prompt.trim(),
      question_count: questionCount,
      question_types: [questionType],
      difficulty: difficulty,
      subject: subject || undefined,
      topic: topic || undefined,
    }

    await startGeneration(config)
  }, [prompt, questionCount, questionType, difficulty, subject, topic, startGeneration])

  // Copy question to clipboard
  const handleCopyQuestion = useCallback((question: GeneratedQuestion) => {
    const text = `${question.question_text}\n\n${question.options?.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n') || ''}\n\nCorrect Answer: ${question.correct_answer}\n\nExplanation: ${question.explanation}`
    navigator.clipboard.writeText(text)
  }, [])

  // Download questions as JSON
  const handleDownload = useCallback(() => {
    const dataStr = JSON.stringify(questions, null, 2)
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr)
    const exportFileDefaultName = `generated-questions-${new Date().toISOString().split('T')[0]}.json`
    const linkElement = document.createElement('a')
    linkElement.setAttribute('href', dataUri)
    linkElement.setAttribute('download', exportFileDefaultName)
    linkElement.click()
  }, [questions])

  // Convert thinking steps to ThinkingStep format
  const thinkingStepsFormatted: ThinkingStep[] = thinkingSteps.map((step, index) => ({
    id: `step-${index}`,
    label: step,
    status: index === thinkingSteps.length - 1 ? 'active' : 'complete',
  }))

  return (
    <div className="space-y-6">
      {/* Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            AI Question Generator
          </CardTitle>
          <CardDescription>
            Generate custom questions using AI. Enter your requirements below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Prompt Input */}
          <div className="space-y-2">
            <Label htmlFor="prompt">What kind of questions do you need?</Label>
            <Textarea
              id="prompt"
              placeholder="e.g., Create questions about photosynthesis for 10th grade biology students focusing on the light-dependent reactions..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[100px]"
            />
          </div>

          {/* Configuration Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                placeholder="e.g., Biology"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Topic</Label>
              <Input
                placeholder="e.g., Photosynthesis"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Number of Questions</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={questionCount}
                onChange={(e) => setQuestionCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Question Type</Label>
              <Select value={questionType} onValueChange={setQuestionType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(QUESTION_TYPES).map((type) => (
                    <SelectItem key={type} value={type}>
                      {QUESTION_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Difficulty Level</Label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(DIFFICULTIES).map((diff) => (
                    <SelectItem key={diff} value={diff}>
                      {DIFFICULTY_LABELS[diff]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-4">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isGenerating ? (
                <>
                  <RotateCcw className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Generate Questions
                </>
              )}
            </Button>
            {isGenerating && (
              <Button variant="outline" onClick={stopGeneration}>
                Stop Generation
              </Button>
            )}
            {(questions.length > 0 || thinkingSteps.length > 0) && (
              <Button variant="ghost" onClick={clearResults}>
                <Trash2 className="h-4 w-4 mr-2" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div>
                <p className="font-medium text-red-800 dark:text-red-200">Generation Error</p>
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress Display */}
      {isGenerating && progress.total > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Generating questions...</span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <Progress value={(progress.current / progress.total) * 100} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chain of Thought - AI Thinking Process */}
      {thinkingSteps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4" />
              AI Thinking Process
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChainOfThought defaultOpen>
              <ChainOfThoughtHeader>View AI reasoning steps</ChainOfThoughtHeader>
              <ChainOfThoughtContent>
                {thinkingStepsFormatted.map((step) => (
                  <ChainOfThoughtStep
                    key={step.id}
                    label={step.label}
                    status={step.status}
                  />
                ))}
              </ChainOfThoughtContent>
            </ChainOfThought>
          </CardContent>
        </Card>
      )}

      {/* Sources Found */}
      {sources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" />
              Source Materials
            </CardTitle>
            <CardDescription>
              Materials used to generate these questions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm leading-relaxed mb-4">
              Questions generated based on{" "}
              <InlineCitation>
                <InlineCitationText>
                  {sources.length} source{sources.length !== 1 ? 's' : ''}
                </InlineCitationText>
                <InlineCitationCard>
                  <InlineCitationCardTrigger 
                    sources={sources.map(s => s.url || `source://${s.id}`)} 
                  />
                  <InlineCitationCardBody>
                    <InlineCitationCarousel>
                      <InlineCitationCarouselHeader>
                        <InlineCitationCarouselPrev />
                        <InlineCitationCarouselNext />
                        <InlineCitationCarouselIndex />
                      </InlineCitationCarouselHeader>
                      <InlineCitationCarouselContent>
                        {sources.map((source) => (
                          <InlineCitationCarouselItem key={source.id}>
                            <InlineCitationSource
                              title={source.title}
                              url={source.url}
                              description={source.excerpt}
                            />
                          </InlineCitationCarouselItem>
                        ))}
                      </InlineCitationCarouselContent>
                    </InlineCitationCarousel>
                  </InlineCitationCardBody>
                </InlineCitationCard>
              </InlineCitation>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generated Questions */}
      {questions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  Generated Questions
                </CardTitle>
                <CardDescription>
                  {questions.length} question{questions.length !== 1 ? 's' : ''} generated
                </CardDescription>
              </div>
              <ArtifactActions>
                <ArtifactAction
                  icon={Download}
                  tooltip="Download all questions"
                  onClick={handleDownload}
                />
                <ArtifactAction
                  icon={Copy}
                  tooltip="Copy all questions"
                  onClick={() => {
                    const allText = questions.map((q, i) => 
                      `Question ${i + 1}:\n${q.question_text}\n\n${q.options?.map((opt, j) => `${String.fromCharCode(65 + j)}. ${opt}`).join('\n') || ''}\n\nCorrect: ${q.correct_answer}\n\nExplanation: ${q.explanation}`
                    ).join('\n\n---\n\n')
                    navigator.clipboard.writeText(allText)
                  }}
                />
              </ArtifactActions>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] pr-4">
              <Accordion type="multiple" className="space-y-4">
                {questions.map((question, index) => (
                  <AccordionItem key={question.question_id} value={question.question_id} className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 text-left">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-medium text-purple-600">
                          {index + 1}
                        </span>
                        <span className="line-clamp-1 flex-1">{question.question_text}</span>
                        <Badge className={getDifficultyColor(question.difficulty)}>
                          {DIFFICULTY_LABELS[question.difficulty as keyof typeof DIFFICULTY_LABELS] || question.difficulty}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4 pt-2">
                        {/* Question Text */}
                        <p className="font-medium">{question.question_text}</p>
                        
                        {/* Options */}
                        {question.options && question.options.length > 0 && (
                          <div className="space-y-2">
                            {question.options.map((option, optIndex) => (
                              <div
                                key={optIndex}
                                className={`flex items-center gap-2 p-2 rounded-lg border ${
                                  option === question.correct_answer
                                    ? 'border-green-500 bg-green-50 dark:bg-green-950/30'
                                    : 'border-border'
                                }`}
                              >
                                <span className="font-bold">{String.fromCharCode(65 + optIndex)}.</span>
                                <span>{option}</span>
                                {option === question.correct_answer && (
                                  <CheckCircle className="h-4 w-4 text-green-600 ml-auto" />
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Correct Answer (for non-MCQ) */}
                        {(!question.options || question.options.length === 0) && question.correct_answer && (
                          <div className="p-3 rounded-lg border border-green-500 bg-green-50 dark:bg-green-950/30">
                            <span className="font-medium">Correct Answer: </span>
                            <span className="text-green-700 dark:text-green-300">{question.correct_answer}</span>
                          </div>
                        )}

                        {/* Explanation */}
                        {question.explanation && (
                          <div className="space-y-1">
                            <Label className="text-muted-foreground">Explanation</Label>
                            <p className="text-sm text-muted-foreground">{question.explanation}</p>
                          </div>
                        )}

                        {/* Source Citations */}
                        {question.source_citations && question.source_citations.length > 0 && (
                          <div className="space-y-2">
                            <Label className="text-muted-foreground">Sources</Label>
                            <div className="text-sm">
                              <InlineCitation>
                                <InlineCitationText>
                                  Based on {question.source_citations.length} source{question.source_citations.length !== 1 ? 's' : ''}
                                </InlineCitationText>
                                <InlineCitationCard>
                                  <InlineCitationCardTrigger 
                                    sources={question.source_citations.map(s => s.material_id)} 
                                  />
                                  <InlineCitationCardBody>
                                    <InlineCitationCarousel>
                                      <InlineCitationCarouselHeader>
                                        <InlineCitationCarouselPrev />
                                        <InlineCitationCarouselNext />
                                        <InlineCitationCarouselIndex />
                                      </InlineCitationCarouselHeader>
                                      <InlineCitationCarouselContent>
                                        {question.source_citations.map((citation, i) => (
                                          <InlineCitationCarouselItem key={i}>
                                            <InlineCitationSource
                                              title={citation.material_title}
                                              description={citation.excerpt}
                                            />
                                          </InlineCitationCarouselItem>
                                        ))}
                                      </InlineCitationCarouselContent>
                                    </InlineCitationCarousel>
                                  </InlineCitationCardBody>
                                </InlineCitationCard>
                              </InlineCitation>
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2">
                          <div className="flex items-center gap-1">
                            <Actions>
                              <ActionCopy onClick={() => handleCopyQuestion(question)} />
                              <ActionRegenerate onClick={() => console.log('Regenerate question', question.question_id)} />
                              <ActionThumbsUp onClick={() => console.log('Thumbs up', question.question_id)} />
                              <ActionThumbsDown onClick={() => console.log('Thumbs down', question.question_id)} />
                            </Actions>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onQuestionsGenerated?.([question])}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add to Bank
                          </Button>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
