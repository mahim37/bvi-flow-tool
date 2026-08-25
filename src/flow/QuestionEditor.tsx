import { useEffect, useId, useMemo, useState } from "react";

import { useUpdateQuestion } from "../api/queries";
import type { AnswerType, Graph, Question } from "../api/types";
import { CHOICE_ANSWER_TYPES } from "../api/types";
import type { QuestionChanges } from "../api/endpoints";
import { answerTypeLabel } from "./labels";
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

/** Sits right next to the question text in `DetailPanel`'s header: closed
 * by default (just the text plus an "Edit" button, break-backend's own
 * affordance for the text alone), opening into one combined form for
 * every editable field on the question -- text included -- rather than a
 * quick inline text editor plus a second, always-open "Edit this
 * question" section further down the panel for everything else. One
 * control, one place, next to the thing it edits. */
export function QuestionEditor({ graph, question }: QuestionEditorProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const updateQuestion = useUpdateQuestion(versionId);

  const promptId = useId();
  const codeId = useId();
  const typeId = useId();
  const sectionId = useId();
  const requiredId = useId();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(question));
  useEffect(() => {
    setDraft(draftOf(question));
    setEditing(false);
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
      {editing ? (
        <form
          className="editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (!dirty) return;
            updateQuestion.mutate(
              { questionId: question.id, changes },
              { onError: onWriteError, onSuccess: () => setEditing(false) },
            );
          }}
        >
          <div className="field">
            <label htmlFor={promptId}>Question text</label>
            <textarea
              id={promptId}
              rows={3}
              value={draft.prompt}
              disabled={pending}
              onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor={codeId}>Code</label>
            <input
              id={codeId}
              value={draft.code}
              disabled={pending}
              onChange={(event) => setDraft({ ...draft, code: event.target.value })}
            />
            {/* Refused on anything this draft inherited, and that refusal is
                the server's. A code is the identity that survives copying --
                the review screen matches every item by it, because a draft is
                a whole copy and every id in it is new -- so renaming an
                inherited one would read as that item removed and a different
                one added, carrying its options and edges with it. */}
            <p className="panel__hint">
              Editable only on something this draft introduced. Renaming an inherited code
              reads as a removal and an addition in the review screen, so the server
              refuses it — retire the question and add its replacement instead.
            </p>
          </div>

          <div className="field">
            <label htmlFor={typeId}>Answer type</label>
            <select
              id={typeId}
              value={draft.answer_type}
              disabled={pending}
              onChange={(event) =>
                setDraft({ ...draft, answer_type: event.target.value as AnswerType })
              }
            >
              {ANSWER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {answerTypeLabel(type)}
                </option>
              ))}
            </select>
            {losingGuards && (
              // The silent-consequence case: the guards would stop matching,
              // the flow would quietly fall to the question-level edge or
              // end, and nothing downstream objects -- no target is dangling,
              // so the publish gate says nothing. The server refuses it, and
              // this says so before the refusal arrives.
              <p className="panel__hint panel__hint--warn">
                Per-option edges leave this question. An answer type that selects no
                option would leave those guards unable to match, with nothing downstream
                to catch it, so this change is refused until they are removed.
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor={sectionId}>Section</label>
            <select
              id={sectionId}
              value={draft.section}
              disabled={pending}
              onChange={(event) => setDraft({ ...draft, section: event.target.value })}
            >
              <option value={NO_SECTION}>No section</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field field--check">
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

          <div className="editor__actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={pending || !dirty}
            >
              {updateQuestion.isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              className="button button--quiet"
              type="button"
              disabled={pending}
              onClick={() => {
                setDraft(draftOf(question));
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="d-question">
          {question.prompt}{" "}
          <button
            type="button"
            className="opt-edit-btn d-edit-btn"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        </p>
      )}

      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
