/**
 * SettingsModal - Modal for configuring question generation settings
 * Features: Subject, topic, difficulty, question type, AI provider, materials
 */
import { useState, useEffect, type ElementType } from 'react'
import { motion } from 'motion/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import {
  Settings,
  BookOpen,
  Target,
  Brain,
  Sliders,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface GenerationSettings {
  subject: string
  topic: string
  questionCount: number
  questionTypes: string[]
  difficulty: string
  aiProvider: string
  modelName: string
  bloomsLevels: string[]
  materialIds: string[]
}

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: GenerationSettings
  onSettingsChange: (settings: GenerationSettings) => void
}

const BLOOMS_LEVELS = [
  { id: 'remember', label: 'Remember', description: 'Recall facts and basic concepts' },
  { id: 'understand', label: 'Understand', description: 'Explain ideas or concepts' },
  { id: 'apply', label: 'Apply', description: 'Use information in new situations' },
  { id: 'analyze', label: 'Analyze', description: 'Draw connections among ideas' },
  { id: 'evaluate', label: 'Evaluate', description: 'Justify a stand or decision' },
  { id: 'create', label: 'Create', description: 'Produce new or original work' },
]

const QUESTION_TYPES = [
  { id: 'multiple-choice', label: 'Multiple Choice', icon: '○' },
  { id: 'true-false', label: 'True/False', icon: '✓' },
  { id: 'short-answer', label: 'Short Answer', icon: '≡' },
  { id: 'essay', label: 'Essay', icon: '¶' },
]

const DIFFICULTIES = [
  { id: 'easy', label: 'Easy', color: 'bg-green-500' },
  { id: 'medium', label: 'Medium', color: 'bg-amber-500' },
  { id: 'hard', label: 'Hard', color: 'bg-red-500' },
  { id: 'mixed', label: 'Mixed', color: 'bg-blue-500' },
]

export function SettingsModal({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: SettingsModalProps) {
  const [localSettings, setLocalSettings] = useState<GenerationSettings>(settings)
  const [expandedSection, setExpandedSection] = useState<string | null>('basic')

  // Sync with parent settings when modal opens
  useEffect(() => {
    if (open) {
      setLocalSettings(settings)
    }
  }, [open, settings])

  const updateSetting = <K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K]
  ) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }))
  }

  const toggleQuestionType = (typeId: string) => {
    setLocalSettings(prev => {
      const types = prev.questionTypes.includes(typeId)
        ? prev.questionTypes.filter(t => t !== typeId)
        : [...prev.questionTypes, typeId]
      return { ...prev, questionTypes: types }
    })
  }

  const toggleBloomsLevel = (levelId: string) => {
    setLocalSettings(prev => {
      const levels = prev.bloomsLevels.includes(levelId)
        ? prev.bloomsLevels.filter(l => l !== levelId)
        : [...prev.bloomsLevels, levelId]
      return { ...prev, bloomsLevels: levels }
    })
  }

  const handleSave = () => {
    onSettingsChange(localSettings)
    onOpenChange(false)
  }

  const SectionHeader = ({ 
    title, 
    icon: Icon, 
    sectionId 
  }: { 
    title: string; 
    icon: ElementType;
    sectionId: string 
  }) => (
    <button
      onClick={() => setExpandedSection(expandedSection === sectionId ? null : sectionId)}
      className="flex items-center justify-between w-full py-3 text-left hover:bg-muted/50 rounded-lg px-2 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title}</span>
      </div>
      {expandedSection === sectionId ? (
        <ChevronUp className="h-4 w-4 text-muted-foreground" />
      ) : (
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Settings className="h-5 w-5" />
            Generation Settings
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[60vh] px-6">
          <div className="py-4 space-y-2">
            {/* Basic Settings */}
            <div>
              <SectionHeader title="Basic Configuration" icon={BookOpen} sectionId="basic" />
              {expandedSection === 'basic' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-4 py-4"
                >
                  {/* Subject */}
                  <div className="space-y-2">
                    <Label htmlFor="subject">Subject *</Label>
                    <Input
                      id="subject"
                      placeholder="e.g., Biology, Mathematics, History"
                      value={localSettings.subject}
                      onChange={(e) => updateSetting('subject', e.target.value)}
                    />
                  </div>

                  {/* Topic */}
                  <div className="space-y-2">
                    <Label htmlFor="topic">Topic *</Label>
                    <Input
                      id="topic"
                      placeholder="e.g., Photosynthesis, Quadratic Equations"
                      value={localSettings.topic}
                      onChange={(e) => updateSetting('topic', e.target.value)}
                    />
                  </div>

                  {/* Question Count */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Number of Questions</Label>
                      <span className="text-sm font-medium">{localSettings.questionCount}</span>
                    </div>
                    <Slider
                      value={[localSettings.questionCount]}
                      onValueChange={([val]) => updateSetting('questionCount', val)}
                      min={1}
                      max={20}
                      step={1}
                      className="w-full"
                    />
                  </div>
                </motion.div>
              )}
            </div>

            <Separator />

            {/* Question Types */}
            <div>
              <SectionHeader title="Question Types" icon={Target} sectionId="types" />
              {expandedSection === 'types' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="py-4"
                >
                  <div className="grid grid-cols-2 gap-2">
                    {QUESTION_TYPES.map((type) => (
                      <button
                        key={type.id}
                        onClick={() => toggleQuestionType(type.id)}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                          localSettings.questionTypes.includes(type.id)
                            ? "border-[#5c4a38] bg-[#5c4a38]/5"
                            : "border-border hover:bg-muted/50"
                        )}
                      >
                        <Checkbox 
                          checked={localSettings.questionTypes.includes(type.id)} 
                          className="pointer-events-none"
                        />
                        <span className="text-lg">{type.icon}</span>
                        <span className="text-sm">{type.label}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

            <Separator />

            {/* Difficulty */}
            <div>
              <SectionHeader title="Difficulty" icon={Sliders} sectionId="ai" />
              {expandedSection === 'ai' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-4 py-4"
                >
                  {/* Difficulty */}
                  <div className="space-y-2">
                    <Label>Difficulty Level</Label>
                    <div className="flex gap-2">
                      {DIFFICULTIES.map((diff) => (
                        <button
                          key={diff.id}
                          onClick={() => updateSetting('difficulty', diff.id)}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border text-sm transition-all",
                            localSettings.difficulty === diff.id
                              ? "border-[#5c4a38] bg-[#5c4a38]/5"
                              : "border-border hover:bg-muted/50"
                          )}
                        >
                          <div className={cn("w-2 h-2 rounded-full", diff.color)} />
                          {diff.label}
                        </button>
                      ))}
                    </div>
                  </div>

                </motion.div>
              )}
            </div>

            <Separator />

            {/* Bloom's Taxonomy */}
            <div>
              <SectionHeader title="Bloom's Taxonomy Levels" icon={Brain} sectionId="blooms" />
              {expandedSection === 'blooms' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="py-4"
                >
                  <div className="space-y-2">
                    {BLOOMS_LEVELS.map((level) => (
                      <button
                        key={level.id}
                        onClick={() => toggleBloomsLevel(level.id)}
                        className={cn(
                          "flex items-start gap-3 p-3 rounded-lg border text-left w-full transition-all",
                          localSettings.bloomsLevels.includes(level.id)
                            ? "border-[#5c4a38] bg-[#5c4a38]/5"
                            : "border-border hover:bg-muted/50"
                        )}
                      >
                        <Checkbox 
                          checked={localSettings.bloomsLevels.includes(level.id)}
                          className="pointer-events-none mt-0.5"
                        />
                        <div>
                          <div className="font-medium text-sm">{level.label}</div>
                          <div className="text-xs text-muted-foreground">{level.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} className="bg-[#5c4a38] hover:bg-[#4a3c2e]">
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsModal
