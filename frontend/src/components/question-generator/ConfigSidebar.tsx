/**
 * ConfigSidebar - Sidebar for configuring question generation parameters.
 * Allows users to control the AI agent's behavior.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  Sparkles,
  Settings2,
  ChevronDown,
  Paperclip,
  ArrowUp,
  Square,
  BookOpen,
  Target,
  Brain,
  Zap,
  Check,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@clerk/clerk-react'
import { API_BASE_URL } from '@/lib/config'
import {
  QUESTION_TYPES as QUESTION_TYPE_VALUES,
  QUESTION_TYPE_LABELS,
  DIFFICULTIES as DIFFICULTY_VALUES,
  DIFFICULTY_LABELS,
} from '@/lib/constants'

interface Material {
  _id: string
  title: string
  material_type: string
}

interface ModelInfo {
  id: string
  name: string
  description: string
}

interface ProviderInfo {
  id: string
  name: string
  description: string
  available: boolean
  models: ModelInfo[]
}

interface ConfigSidebarProps {
  // Form state
  prompt: string
  onPromptChange: (value: string) => void
  questionCount: number
  onQuestionCountChange: (value: number) => void
  questionType: string
  onQuestionTypeChange: (value: string) => void
  difficulty: string
  onDifficultyChange: (value: string) => void
  aiProvider: string
  onAiProviderChange: (value: string) => void
  selectedModel: string
  onModelChange: (value: string) => void
  bloomsLevels: string[]
  onBloomsLevelsChange: (value: string[]) => void

  // Materials
  selectedMaterials: Material[]
  onMaterialsClick: () => void

  // Actions
  isGenerating: boolean
  onGenerate: () => void
  onStop: () => void
}

const questionTypes = [
  {
    value: QUESTION_TYPE_VALUES.MULTIPLE_CHOICE,
    label: QUESTION_TYPE_LABELS[QUESTION_TYPE_VALUES.MULTIPLE_CHOICE],
  },
  {
    value: QUESTION_TYPE_VALUES.TRUE_FALSE,
    label: QUESTION_TYPE_LABELS[QUESTION_TYPE_VALUES.TRUE_FALSE],
  },
  {
    value: QUESTION_TYPE_VALUES.SHORT_ANSWER,
    label: QUESTION_TYPE_LABELS[QUESTION_TYPE_VALUES.SHORT_ANSWER],
  },
  {
    value: QUESTION_TYPE_VALUES.ESSAY,
    label: QUESTION_TYPE_LABELS[QUESTION_TYPE_VALUES.ESSAY],
  },
]

const difficulties = [
  {
    value: DIFFICULTY_VALUES.EASY,
    label: DIFFICULTY_LABELS[DIFFICULTY_VALUES.EASY],
    dotColor: 'bg-green-500',
  },
  {
    value: DIFFICULTY_VALUES.MEDIUM,
    label: DIFFICULTY_LABELS[DIFFICULTY_VALUES.MEDIUM],
    dotColor: 'bg-yellow-500',
  },
  {
    value: DIFFICULTY_VALUES.HARD,
    label: DIFFICULTY_LABELS[DIFFICULTY_VALUES.HARD],
    dotColor: 'bg-red-500',
  },
]

const bloomsOptions = [
  { value: 'REMEMBER', label: 'Remember', icon: '📚' },
  { value: 'UNDERSTAND', label: 'Understand', icon: '💡' },
  { value: 'APPLY', label: 'Apply', icon: '🔧' },
  { value: 'ANALYZE', label: 'Analyze', icon: '🔍' },
  { value: 'EVALUATE', label: 'Evaluate', icon: '⚖️' },
  { value: 'CREATE', label: 'Create', icon: '✨' },
]

export function ConfigSidebar({
  prompt,
  onPromptChange,
  questionCount,
  onQuestionCountChange,
  questionType,
  onQuestionTypeChange,
  difficulty,
  onDifficultyChange,
  aiProvider,
  onAiProviderChange,
  selectedModel,
  onModelChange,
  bloomsLevels,
  onBloomsLevelsChange,
  selectedMaterials,
  onMaterialsClick,
  isGenerating,
  onGenerate,
  onStop,
}: ConfigSidebarProps) {
  const { getToken } = useAuth()
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Fallback static models in case API fails
  const fallbackProviders = [
    {
      id: 'groq',
      name: 'Groq',
      description: 'Ultra-fast inference with open models',
      available: true,
      models: [
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Most versatile', available: true },
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', description: 'Fast responses', available: true },
        { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B', description: 'Latest multimodal', available: true },
      ]
    }
  ]

  // Fetch available providers and models
  useEffect(() => {
    const fetchProviders = async () => {
      setIsLoadingProviders(true)
      try {
        const token = await getToken()
        const response = await fetch(
          `${API_BASE_URL}/question-generator/available-models`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (response.ok) {
          const data = await response.json()
          // Use API data if available, otherwise fallback
          setProviders(data.providers && data.providers.length > 0 ? data.providers : fallbackProviders)
        } else {
          // Use fallback on error
          setProviders(fallbackProviders)
        }
      } catch (error) {
        console.error('Failed to fetch providers, using fallback:', error)
        // Use fallback on error
        setProviders(fallbackProviders)
      } finally {
        setIsLoadingProviders(false)
      }
    }
    fetchProviders()
  }, [getToken])

  // Get current model display info
  const getCurrentModelDisplay = () => {
    const provider = providers.find(p => p.id === aiProvider)
    if (!provider) return { providerName: aiProvider, modelName: selectedModel }
    const model = provider.models.find(m => m.id === selectedModel)
    return {
      providerName: provider.name,
      modelName: model?.name || selectedModel || provider.models[0]?.name || 'Default'
    }
  }

  // Handle model selection
  const handleModelSelect = (providerId: string, modelId: string) => {
    onAiProviderChange(providerId)
    onModelChange(modelId)
  }

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '60px'
    const newHeight = Math.min(Math.max(60, textarea.scrollHeight), 200)
    textarea.style.height = `${newHeight}px`
  }, [])

  useEffect(() => {
    adjustHeight()
  }, [prompt, adjustHeight])

  const toggleBloomsLevel = (level: string) => {
    if (bloomsLevels.includes(level)) {
      onBloomsLevelsChange(bloomsLevels.filter(l => l !== level))
    } else {
      onBloomsLevelsChange([...bloomsLevels, level])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isGenerating) {
      e.preventDefault()
      onGenerate()
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
          {/* Prompt Input */}
          <div className="relative rounded-xl border border-border bg-background/50 focus-within:border-primary/50 transition-colors">
            {/* Selected Materials */}
            {selectedMaterials.length > 0 && (
              <div className="flex flex-wrap gap-1 p-3 pb-0">
                {selectedMaterials.slice(0, 3).map(m => (
                  <Badge key={m._id} variant="secondary" className="text-xs">
                    {m.title.slice(0, 20)}...
                  </Badge>
                ))}
                {selectedMaterials.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{selectedMaterials.length - 3} more
                  </Badge>
                )}
              </div>
            )}

            {/* Textarea */}
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what questions you want to generate..."
              className="min-h-[60px] max-h-[200px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-3 text-sm"
            />

            {/* Bottom Actions */}
            <div className="flex items-center justify-between p-3 pt-0 border-t border-border/50 mt-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-muted-foreground hover:text-foreground"
                onClick={onMaterialsClick}
              >
                <Paperclip className="h-4 w-4 mr-1.5" />
                {selectedMaterials.length > 0 ? `${selectedMaterials.length} files` : 'Attach'}
              </Button>

              <Button
                size="sm"
                className={cn(
                  'h-8 px-4',
                  isGenerating
                    ? 'bg-destructive hover:bg-destructive/90'
                    : 'bg-primary hover:bg-primary/90'
                )}
                onClick={isGenerating ? onStop : onGenerate}
                disabled={!prompt.trim() && selectedMaterials.length === 0}
              >
                {isGenerating ? (
                  <>
                    <Square className="h-3 w-3 mr-1.5 fill-current" />
                    Stop
                  </>
                ) : (
                  <>
                    <ArrowUp className="h-4 w-4 mr-1.5" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Quick Settings */}
          <div className="grid grid-cols-2 gap-3">
            {/* Question Count */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Target className="h-3 w-3" />
                Count: {questionCount}
              </label>
              <Slider
                value={[questionCount]}
                onValueChange={([v]) => onQuestionCountChange(v)}
                min={1}
                max={20}
                step={1}
                className="w-full"
              />
            </div>

            {/* Difficulty */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Zap className="h-3 w-3" />
                Difficulty
              </label>
              <Select value={difficulty} onValueChange={onDifficultyChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {difficulties.map(d => (
                    <SelectItem key={d.value} value={d.value}>
                      <span className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${d.dotColor}`} />
                        {d.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Question Type */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <BookOpen className="h-3 w-3" />
                Type
              </label>
              <Select value={questionType} onValueChange={onQuestionTypeChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {questionTypes.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* AI Model Selector - ChatGPT style */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                AI Model
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full h-8 justify-between text-xs font-normal"
                    disabled={isLoadingProviders}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className="font-medium">{getCurrentModelDisplay().providerName}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="truncate">{getCurrentModelDisplay().modelName}</span>
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Select AI Provider & Model
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {providers.map((provider) => (
                    <DropdownMenuSub key={provider.id}>
                      <DropdownMenuSubTrigger
                        className={cn(
                          "flex items-center gap-2",
                          !provider.available && "opacity-50"
                        )}
                        disabled={!provider.available}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{provider.name}</span>
                            {aiProvider === provider.id && (
                              <Check className="h-3 w-3 text-primary" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {provider.description}
                          </p>
                        </div>
                        {!provider.available && (
                          <AlertCircle className="h-3 w-3 text-muted-foreground" />
                        )}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        {provider.models.map((model) => (
                          <DropdownMenuItem
                            key={model.id}
                            onClick={() => handleModelSelect(provider.id, model.id)}
                            className="flex items-center justify-between"
                          >
                            <div>
                              <div className="font-medium text-sm">{model.name}</div>
                              <p className="text-xs text-muted-foreground line-clamp-1">
                                {model.description}
                              </p>
                            </div>
                            {aiProvider === provider.id && selectedModel === model.id && (
                              <Check className="h-4 w-4 text-primary shrink-0" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                  {providers.length === 0 && !isLoadingProviders && (
                    <DropdownMenuItem disabled>
                      <span className="text-muted-foreground">No providers available</span>
                    </DropdownMenuItem>
                  )}
                  {isLoadingProviders && (
                    <DropdownMenuItem disabled>
                      <span className="text-muted-foreground">Loading providers...</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Advanced Settings */}
          <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between h-8 px-2">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Settings2 className="h-3 w-3" />
                  Advanced Settings
                </span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', isAdvancedOpen && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="space-y-3">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Brain className="h-3 w-3" />
                  Bloom's Taxonomy Levels
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {bloomsOptions.map(b => (
                    <Badge
                      key={b.value}
                      variant={bloomsLevels.includes(b.value) ? 'default' : 'outline'}
                      className={cn(
                        'cursor-pointer text-xs transition-colors',
                        bloomsLevels.includes(b.value) && 'bg-primary'
                      )}
                      onClick={() => toggleBloomsLevel(b.value)}
                    >
                      {b.icon} {b.label}
                    </Badge>
                  ))}
                </div>
                {bloomsLevels.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No levels selected = Auto-select based on difficulty
                  </p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  )
}

export default ConfigSidebar
