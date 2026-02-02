// AI Components for LearnTrack
// Based on shadcn/ui AI component patterns

// Inline Citation - For displaying source references
export {
  InlineCitation,
  InlineCitationText,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselItem,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselPrev,
  InlineCitationCarouselNext,
  InlineCitationSource,
  InlineCitationQuote,
  type InlineCitationProps,
  type InlineCitationTextProps,
  type InlineCitationCardProps,
  type InlineCitationCardTriggerProps,
  type InlineCitationCardBodyProps,
  type InlineCitationCarouselProps,
  type InlineCitationCarouselContentProps,
  type InlineCitationCarouselItemProps,
  type InlineCitationCarouselHeaderProps,
  type InlineCitationCarouselIndexProps,
  type InlineCitationCarouselPrevProps,
  type InlineCitationCarouselNextProps,
  type InlineCitationSourceProps,
  type InlineCitationQuoteProps,
  type SourceMaterial,
  type CitationData,
} from './inline-citation'

// Chain of Thought - For displaying AI reasoning
export {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
  ChainOfThoughtImage,
  type ChainOfThoughtProps,
  type ChainOfThoughtHeaderProps,
  type ChainOfThoughtStepProps,
  type ChainOfThoughtSearchResultsProps,
  type ChainOfThoughtSearchResultProps,
  type ChainOfThoughtContentProps,
  type ChainOfThoughtImageProps,
  type ThinkingStep,
} from './chain-of-thought'

// Artifact - For displaying generated content
export {
  Artifact,
  ArtifactHeader,
  ArtifactClose,
  ArtifactTitle,
  ArtifactDescription,
  ArtifactActions,
  ArtifactAction,
  ArtifactContent,
  type ArtifactProps,
  type ArtifactHeaderProps,
  type ArtifactCloseProps,
  type ArtifactTitleProps,
  type ArtifactDescriptionProps,
  type ArtifactActionsProps,
  type ArtifactActionProps,
  type ArtifactContentProps,
  type QuestionArtifact,
} from './artifact'

// Actions - For AI message actions
export {
  Actions,
  Action,
  ActionCopy,
  ActionRegenerate,
  ActionThumbsUp,
  ActionThumbsDown,
  type ActionsProps,
  type ActionProps,
} from './actions'

// Question Generator Component
export { default as AIQuestionGenerator } from './question-generator'
export type { AIQuestionGeneratorProps } from './question-generator'
