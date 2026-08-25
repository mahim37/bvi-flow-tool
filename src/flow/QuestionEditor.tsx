import { useEffect, useId, useMemo, useState } from "react";

import { useReorderQuestions, useUpdateQuestion } from "../api/queries";
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
 * and sends only what moved. `prompt` is not here -- it is edited inline
 * in `DetailPanel`'s header now, matching break-backend's own edit-in-
 * place affordance for question text. */
interface Draft {
  code: string;
  answer_type: AnswerType;
  is_required: boolean;
  section: string;
}

function draftOf(question: Question): Draft {
  return {
    code: question.code,
    answer_type: question.answer_type,
    is_required: question.is_required,
    section: question.section ?? NO_SECTION,
  };
}

export function QuestionEditor({ graph, question }: QuestionEditorProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const updateQuestion = useUpdateQuestion(versionId);
  const reorderQuestions = useReorderQuestions(versionId);

  const codeId = useId();
  const typeId = useId();
  const sectionId = useId();
  const requiredId = useId();

  const [draft, setDraft] = useState<Draft>(() => draftOf(question));
  useEffect(() => setDraft(draftOf(question)), [question]);

  const sections = useMemo(
    () =>
      [...graph.sections].sort(
        (left, right) => left.display_order - right.display_order,
      ),
    [graph.sections],
  );

  // The whole live ordering, because that is what the reorder verb takes:
  // a single-row `display_order` write is a swap against a unique
  // constraint, and a client orchestrating one trips it partway.
  const live = useMemo(
    () =>
      graph.questions
        .filter((candidate) => candidate.archived_at === null)
        .sort((left, right) => left.display_order - right.display_order),
    [graph.questions],
  );
  const index = live.findIndex((candidate) => candidate.id === question.id);

  const pending = updateQuestion.isPending || reorderQuestions.isPending;
  const error =
    writeErrorMessage(updateQuestion.error) ?? writeErrorMessage(reorderQuestions.error);

  /** Only the keys that moved. `FlowToolQuestionUpdateSerializer` has no
   * defaults and the view is partial, so an absent key means "leave this
   * alone" -- sending the whole object would rewrite fields nobody
   * touched, and `code` is refused outright on anything this draft
   * inherited. */
  function changed(): QuestionChanges {
    const changes: QuestionChanges = {};
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

  function move(direction: -1 | 1) {
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= live.length) return;
    const ordered = live.map((item) => item.id);
    const here = ordered[index];
    const there = ordered[swapWith];
    if (here === undefined || there === undefined) return;
    ordered[index] = there;
    ordered[swapWith] = here;
    reorderQuestions.mutate(ordered, { onError: onWriteError });
  }

  const losingGuards =
    CHOICE_ANSWER_TYPES.has(question.answer_type) &&
    !CHOICE_ANSWER_TYPES.has(draft.answer_type) &&
    graph.edges.some(
      (edge) => edge.from_question === question.id && edge.from_option !== null,
    );

  return (
    <section className="panel__section" aria-labelledby="question-editor">
      <h3 id="question-editor" className="panel__heading">
        Edit this question
      </h3>

      <form
        className="editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty) return;
          updateQuestion.mutate(
            { questionId: question.id, changes },
            { onError: onWriteError },
          );
        }}
      >
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
            disabled={pending || !dirty}
            onClick={() => setDraft(draftOf(question))}
          >
            Revert
          </button>
        </div>
      </form>

      <div className="editor__row">
        <span className="editor__rowlabel">
          Position {index + 1} of {live.length}
        </span>
        <button
          className="button button--quiet"
          type="button"
          disabled={pending || index <= 0}
          onClick={() => move(-1)}
        >
          Move earlier
        </button>
        <button
          className="button button--quiet"
          type="button"
          disabled={pending || index < 0 || index >= live.length - 1}
          onClick={() => move(1)}
        >
          Move later
        </button>
      </div>
      {/* Order is presentational under graph routing, with one exception
          worth knowing before pressing those buttons. */}
      <p className="panel__hint">
        Order is presentational here — routing is by edge, not by position. The one
        exception: the earliest live question is the entry point, so moving something
        into first place changes where a session starts.
      </p>

      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
