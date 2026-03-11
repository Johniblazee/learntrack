import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { QuestionCanvas } from '@/components/question-generator/QuestionCanvas'


describe('QuestionCanvas', () => {
  it('shows publish and approve-all actions for the correct draft counts', () => {
    render(
      <QuestionCanvas
        isGenerating={false}
        currentAction={null}
        thinkingSteps={[]}
        progress={{ current: 3, total: 3 }}
        foundSources={[]}
        questions={[
          {
            question_id: 'q1',
            type: 'multiple-choice',
            difficulty: 'medium',
            question_text: 'Pending question',
            options: ['A) One', 'B) Two'],
            correct_answer: 'B',
            status: 'pending',
          },
          {
            question_id: 'q2',
            type: 'multiple-choice',
            difficulty: 'medium',
            question_text: 'Approved question',
            options: ['A) One', 'B) Two'],
            correct_answer: 'B',
            status: 'approved',
          },
          {
            question_id: 'q3',
            type: 'multiple-choice',
            difficulty: 'medium',
            question_text: 'Published question',
            options: ['A) One', 'B) Two'],
            correct_answer: 'B',
            status: 'approved',
            published_question_id: 'bank-1',
          },
        ]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onRequestRegenerate={vi.fn()}
        onDelete={vi.fn()}
        onApproveAll={vi.fn()}
        onPublishApproved={vi.fn()}
        onExport={vi.fn()}
      />,
    )

    expect(screen.getByText('Publish Approved (1)')).toBeInTheDocument()
    expect(screen.getByText('Approve All (1)')).toBeInTheDocument()
    expect(screen.getByText('1 published')).toBeInTheDocument()
  })
})
