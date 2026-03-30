import { BrowserRecordRow } from '../components/ui';
import { useAppData } from '../contexts';
import { COMPANION_NOTES_PATH, COMPANION_PROJECTS_PATH, COMPANION_SKILLS_PATH } from './routes';

export function CompanionKnowledgePage() {
  const { projects } = useAppData();
  const projectCount = projects?.length ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <h1 className="text-[22px] font-semibold tracking-tight text-primary">Knowledge</h1>
          <p className="mt-1 text-[11px] text-dim">Projects, notes, and skills in one place.</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-4">
          <div className="space-y-2 px-4">
            <BrowserRecordRow
              to={COMPANION_PROJECTS_PATH}
              label="Knowledge"
              aside={projectCount === null ? undefined : `${projectCount} project${projectCount === 1 ? '' : 's'}`}
              heading="Projects"
              summary="Read current focus, blockers, notes, and linked conversations."
              meta="Durable tracked work"
              className="py-3.5"
              titleClassName="text-[15px]"
              summaryClassName="text-[13px]"
              metaClassName="text-[11px] break-words"
            />
            <BrowserRecordRow
              to={COMPANION_NOTES_PATH}
              label="Knowledge"
              heading="Notes"
              summary="Browse durable note nodes and distilled references."
              meta="Shared knowledge"
              className="py-3.5"
              titleClassName="text-[15px]"
              summaryClassName="text-[13px]"
              metaClassName="text-[11px] break-words"
            />
            <BrowserRecordRow
              to={COMPANION_SKILLS_PATH}
              label="Knowledge"
              heading="Skills"
              summary="Review reusable workflows and agent procedures."
              meta="Reusable workflows"
              className="py-3.5"
              titleClassName="text-[15px]"
              summaryClassName="text-[13px]"
              metaClassName="text-[11px] break-words"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
