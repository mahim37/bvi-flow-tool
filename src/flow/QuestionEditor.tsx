import { useEffect, useId, useMemo, useState } from "react";

import { Pencil } from "lucide-react";

import { useUpdateQuestion } from "../api/queries";
import type { AnswerType, Graph, Question } from "../api/types";
import { CHOICE_ANSWER_TYPES } from "../api/types";
import type { QuestionChanges } from "../api/endpoints";
import { answerTypeLabel } from "./labels";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, nativeSelectClassName } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { checkRow, editorActions, warnHint } from "@/lib/chrome";
import { EditorDialog } from "./EditorDialog";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

const ANSWER_TYPES: AnswerType[] = [
  "single_choice",
  "multi_choice",
  "free_text",
  "scale",
];
const NO_SECTION = "__none__";

interface QuestionEditorProps {
  graph: Graph;
  question: Question;
}

/** The fields as they currently stand, for a form that starts from them
 * and sends only what moved. */
interface Draft {
  prompt: string;
  code: string;
  answer_type: AnswerType;
  is_required: boolean;
  section: string;
}

function draftOf(question: Question): Draft {
  return {
    prompt: question.prompt,
    code: question.code,
    answer_type: question.answer_type,
    is_required: question.is_required,
    section: question.section ?? NO_SECTION,
  };
}

/** Sits right next to the question text in `DetailPanel`'s header: the
 * text stays visible, and Edit opens one dialog for every field on the
 * question rather than expanding an inline form in place of the title. */
export function QuestionEditor({ graph, question }: QuestionEditorProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const updateQuestion = useUpdateQuestion(versionId);

  const promptId = useId();
  const codeId = useId();
  const typeId = useId();
  const sectionId = useId();
  const requiredId = useId();

  const [draft, setDraft] = useState<Draft>(() => draftOf(question));
  useEffect(() => {
    setDraft(draftOf(question));
  }, [question]);

  const sections = useMemo(
    () =>
      [...graph.sections].sort(
        (left, right) => left.display_order - right.display_order,
      ),
    [graph.sections],
  );

  const pending = updateQuestion.isPending;
  const error = writeErrorMessage(updateQuestion.error);

  /** Only the keys that moved. `FlowToolQuestionUpdateSerializer` has no
   * defaults and the view is partial, so an absent key means "leave this
   * alone" -- sending the whole object would rewrite fields nobody
   * touched, and `code` is refused outright on anything this draft
   * inherited. */
  function changed(): QuestionChanges {
    const changes: QuestionChanges = {};
    if (draft.prompt !== question.prompt) changes.prompt = draft.prompt;
    if (draft.code !== question.code) changes.code = draft.code;
    if (draft.answer_type !== question.answer_type) {
      changes.answer_type = draft.answer_type;
    }
    if (draft.is_required !== question.is_required) {
      changes.is_required = draft.is_required;
    }
    const section = draft.section === NO_SECTION ? null : draft.section;
    if (section !== question.section) changes.section = section;
    return changes;
  }

  const changes = changed();
  const dirty = Object.keys(changes).length > 0;

  const losingGuards =
    CHOICE_ANSWER_TYPES.has(question.answer_type) &&
    !CHOICE_ANSWER_TYPES.has(draft.answer_type) &&
    graph.edges.some(
      (edge) => edge.from_question === question.id && edge.from_option !== null,
    );

  return (
    <>
      <div className="flex items-start gap-2">
        <h2 className="m-0 min-w-0 flex-1 text-base leading-snug font-medium">
          {question.prompt}
        </h2>
        <EditorDialog
          title="Edit question"
          className="max-h-[min(90svh,44rem)] overflow-y-auto"
          onOpenChange={(open) => {
            if (open) setDraft(draftOf(question));
          }}
          trigger={
            <Button
              variant="outline"
              size="icon-sm"
              className="shrink-0"
              aria-label="Edit question"
              title="Edit question"
            >
              <Pencil />
            </Button>
          }
        >
          {(close) => (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!dirty) return;
                updateQuestion.mutate(
                  { questionId: question.id, changes },
                  { onError: onWriteError, onSuccess: close },
                );
              }}
            >
              <Field label="Question text" htmlFor={promptId}>
                <Textarea
                  id={promptId}
                  rows={3}
                  value={draft.prompt}
                  {...(pending ? { disabled: true } : {})}
                  onChange={(event) =>
                    setDraft({ ...draft, prompt: event.target.value })
                  }
                />
              </Field>

              <Field label="QID" htmlFor={codeId}>
                <Input
                  id={codeId}
                  value={draft.code}
                  {...(pending ? { disabled: true } : {})}
                  onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                />
              </Field>

              <Field label="Answer type" htmlFor={typeId}>
                <select
                  id={typeId}
                  className={nativeSelectClassName}
                  value={draft.answer_type}
                  {...(pending ? { disabled: true } : {})}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      answer_type: event.target.value as AnswerType,
                    })
                  }
                >
                  {ANSWER_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {answerTypeLabel(type)}
                    </option>
                  ))}
                </select>
                {losingGuards && (
                  <p className={warnHint}>
                    Per-option edges leave this question. An answer type that selects no
                    option would leave those guards unable to match, with nothing
                    downstream to catch it, so this change is refused until they are
                    removed.
                  </p>
                )}
              </Field>

              <Field label="Section" htmlFor={sectionId}>
                <select
                  id={sectionId}
                  className={nativeSelectClassName}
                  value={draft.section}
                  {...(pending ? { disabled: true } : {})}
                  onChange={(event) =>
                    setDraft({ ...draft, section: event.target.value })
                  }
                >
                  <option value={NO_SECTION}>No section</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div className={checkRow}>
                <input
                  id={requiredId}
                  type="checkbox"
                  checked={draft.is_required}
                  disabled={pending}
                  onChange={(event) =>
                    setDraft({ ...draft, is_required: event.target.checked })
                  }
                />
                <label htmlFor={requiredId}>Required</label>
              </div>

              {error !== null && (
                <Banner tone="error" role="alert">
                  {error}
                </Banner>
              )}

              <div className={editorActions}>
                <Button
                  variant="primary"
                  type="submit"
                  loading={pending}
                  disabled={!dirty}
                >
                  Save changes
                </Button>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setDraft(draftOf(question));
                    close();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </EditorDialog>
      </div>
    </>
  );
}
