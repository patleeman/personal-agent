import { Pill, cx } from '../ui';
import type { AskUserQuestionAnswers, AskUserQuestionPresentation } from '../../transcript/askUserQuestions';

type ConversationQuestion = AskUserQuestionPresentation['questions'][number];

export function ConversationQuestionShelf({
  presentation,
  activeQuestion,
  activeQuestionIndex,
  activeOptionIndex,
  answers,
  submitting,
  answeredCount,
  onActivateQuestion,
  onSelectOption,
}: {
  presentation: AskUserQuestionPresentation;
  activeQuestion: ConversationQuestion;
  activeQuestionIndex: number;
  activeOptionIndex: number;
  answers: AskUserQuestionAnswers;
  submitting: boolean;
  answeredCount: number;
  onActivateQuestion: (questionIndex: number) => void;
  onSelectOption: (questionIndex: number, optionIndex: number) => void;
}) {
  return (
    <div className="border-b border-border-subtle px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="ui-section-label">Answer below</span>
        <Pill tone="warning">{answeredCount}/{presentation.questions.length}</Pill>
      </div>

      {presentation.questions.length > 1 && (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
          {presentation.questions.map((question, index) => {
            const answered = (answers[question.id]?.length ?? 0) > 0;
            const active = index === activeQuestionIndex;
            return (
              <button
                key={question.id}
                type="button"
                onClick={() => onActivateQuestion(index)}
                className={cx(
                  'ui-action-button min-w-0 px-1.5 py-0.5 text-[11px]',
                  active
                    ? 'text-primary'
                    : answered
                      ? 'text-secondary'
                      : 'text-dim',
                )}
              >
                <span aria-hidden="true" className={cx('shrink-0 text-[11px]', answered ? 'text-success' : active ? 'text-accent' : 'text-dim/70')}>
                  {answered ? '✓' : active ? '•' : '○'}
                </span>
                <span className="truncate">{question.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-1.5">
        <p className="text-[13px] font-medium text-primary break-words">{activeQuestion.label}</p>
        {activeQuestion.details && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-secondary break-words">{activeQuestion.details}</p>
        )}
      </div>

      <div
        className="mt-1 -mx-0.5"
        role={activeQuestion.style === 'check' ? 'group' : 'radiogroup'}
        aria-label={activeQuestion.label}
      >
        {activeQuestion.options.map((option, optionIndex) => {
          const selectedValues = answers[activeQuestion.id] ?? [];
          const checked = selectedValues.includes(option.value);
          const active = optionIndex === activeOptionIndex;
          const indicator = activeQuestion.style === 'check'
            ? (checked ? '☑' : '☐')
            : (checked ? '◉' : '◯');
          return (
            <button
              key={`${activeQuestion.id}:${option.value}`}
              type="button"
              disabled={submitting}
              onClick={() => onSelectOption(activeQuestionIndex, optionIndex)}
              className={cx(
                'ui-list-row -mx-0.5 w-full items-start gap-2 px-2.5 py-1 text-left disabled:opacity-40',
                checked || active ? 'ui-list-row-selected' : 'ui-list-row-hover',
              )}
            >
              <span className={cx('mt-px w-8 shrink-0 text-[12px]', checked || active ? 'text-accent' : 'text-dim')} aria-hidden="true">
                {optionIndex + 1}. {indicator}
              </span>
              <span className="min-w-0 flex-1">
                <span className="ui-row-title block break-words text-[14px]">{option.label}</span>
                {option.details && (
                  <span className="ui-row-summary block break-words text-[13px]">{option.details}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-1.5 text-[11px] text-dim">
        Type 1-9 to select · Tab/Shift+Tab or ←/→ switches questions · ↑/↓ moves · Enter selects or submits · type a normal message to skip
      </p>
    </div>
  );
}
