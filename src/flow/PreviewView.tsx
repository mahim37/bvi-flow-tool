import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import predmindLogo from "../assets/predmind-logo.webp";
import { ApiError } from "../api/client";
import { usePreviewWalk } from "../api/queries";
import { CHOICE_ANSWER_TYPES } from "../api/types";
import type { PreviewAnswer, PreviewState, QuestionRecord, UUID } from "../api/types";
import { useVersionContext } from "./versionContext";
import { previewInstruction, versionLabel } from "./labels";

/** What the walk stood on, so a reader can see the route rather than just
 * where it ended. Kept beside the answers because the payload names only
 * the *next* question -- a question already answered has left the walk. */
interface Step {
  question: QuestionRecord;
  optionIds: UUID[];
}

function answersFrom(steps: Step[]): PreviewAnswer[] {
  return steps.map((step) => ({
    question_id: step.question.id,
    option_ids: step.optionIds,
  }));
}

export function PreviewView() {
  const { versionId } = useParams<{ versionId: string }>();
  const { graph } = useVersionContext();
  const walk = usePreviewWalk(versionId as UUID);

  const [steps, setSteps] = useState<Step[]>([]);
  const [state, setState] = useState<PreviewState | null>(null);
  const [chosen, setChosen] = useState<UUID[]>([]);

  const { mutate } = walk;

  /**
   * Every call replays the whole answer list from the entry point.
   *
   * That is the endpoint's design rather than a limitation this works
   * around: nothing is stored, so there is no preview session to expire,
   * to lock, or to leave pointing at a question an edit has since removed.
   * It also means "go back" is just dropping the last answer and asking
   * again, with no undo state to keep straight.
   */
  const walkTo = useCallback(
    (next: Step[]) => {
      mutate(answersFrom(next), {
        onSuccess: (result) => {
          setSteps(next);
          setState(result);
          setChosen([]);
        },
      });
    },
    [mutate],
  );

  // Restarted whenever the version changes, because the answers are option
  // ids from the version that was open: replaying them against another one
  // is exactly the typo case the server validates against.
  useEffect(() => {
    setSteps([]);
    setState(null);
    setChosen([]);
    mutate([], { onSuccess: (result) => setState(result) });
  }, [versionId, mutate]);

  const question = state?.next_question ?? null;
  const isChoice = question !== null && CHOICE_ANSWER_TYPES.has(question.answer_type);
  const isMulti = question?.answer_type === "multi_choice";

  function toggle(optionId: UUID) {
    setChosen((current) =>
      isMulti
        ? current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId]
        : [optionId],
    );
  }

  function answer() {
    if (question === null) return;
    walkTo([...steps, { question, optionIds: chosen }]);
  }

  const conflict = walk.error instanceof ApiError && walk.error.isConflict;

  return (
    <main className="page page--preview">
      <header className="page__header">
        <h2 className="page__title">Preview</h2>
        <p className="page__subtitle">
          {versionLabel(graph.version)} — walked through the same resolver that serves a
          real respondent, so what you see here is what production would do.
        </p>
      </header>

      {conflict && (
        // Not an error to apologise for: a cycle or a dangling target is
        // the crash a respondent would get, found by somebody who can
        // still fix it. That is the feature.
        <p className="banner banner--error" role="alert">
          <strong>The routing is broken here.</strong> {walk.error?.message} A
          respondent reaching this point would get an error rather than a question. Fix
          it on the map and walk again.
        </p>
      )}

      {walk.isError && !conflict && (
        <p className="banner banner--error" role="alert">
          {walk.error instanceof Error
            ? walk.error.message
            : "Could not walk this version."}
        </p>
      )}

      {state !== null && (
        <p className="preview__progress" role="status">
          {state.answered_count} of {state.total_count} answered
          {/* The denominator is the questions reachable from the entry
              point, not every question in the version: an unreachable one
              is never served, so counting it would make a completed walk
              look unfinished. */}
          <span className="preview__progressnote">
            {" "}
            — of the questions reachable from the entry point
          </span>
        </p>
      )}

      <div className="preview__body">
        <section className="preview__current" aria-labelledby="preview-question">
          {/* Ported from break-backend's own preview walkthrough
              (question_graph_editor's `.preview-stage`/`.preview-logo`) --
              the respondent's own logo, not this tool's admin chrome, so
              this reads as what a respondent would actually be shown. */}
          <img className="preview__logo" src={predmindLogo} alt="Predmind" />

          {state === null && walk.isPending && <p className="empty">Starting…</p>}

          {state?.is_complete === true && (
            <>
              <h3 id="preview-question" className="preview__question">
                The questionnaire ends here
              </h3>
              <p className="preview__subtitle">
                {steps.length === 0
                  ? "No question is served at all: this version has no live entry point."
                  : "Nothing routes onward from the last answer, so a respondent would be finished."}
              </p>
            </>
          )}

          {question !== null && (
            <>
              <p className="preview__question-code">{question.code}</p>
              <h3 id="preview-question" className="preview__question">
                {question.prompt}
              </h3>

              {isChoice ? (
                <>
                  <p className="preview__subtitle">
                    {previewInstruction(isMulti)}
                    {question.is_required
                      ? ""
                      : " Optional — you can continue without picking one."}
                  </p>
                  <ul className="preview__options">
                    {question.options.map((option) => {
                      const selected = chosen.includes(option.id);
                      return (
                        <li key={option.id}>
                          <label
                            className={`preview__option${selected ? " preview__option--selected" : ""}`}
                          >
                            <input
                              type={isMulti ? "checkbox" : "radio"}
                              name="preview-answer"
                              checked={selected}
                              onChange={() => toggle(option.id)}
                            />
                            <span>{option.label}</span>
                            <code className="options__code">{option.code}</code>
                          </label>
                        </li>
                      );
                    })}
                    {question.options.length === 0 && (
                      <li className="empty">
                        This question offers no options, so nothing can be selected and
                        only a question-level edge can fire.
                      </li>
                    )}
                  </ul>
                </>
              ) : (
                // A free-text or scale answer selects no option at all, so
                // there is nothing to type here that could change the
                // route. Saying so is more honest than a text box whose
                // contents the resolver would ignore.
                <p className="preview__subtitle">
                  Answers to this question select no option, so only a question-level
                  edge can fire. What a respondent writes does not change where the flow
                  goes.
                </p>
              )}

              <div className="preview__actions">
                <button
                  className="button button--primary preview__next"
                  type="button"
                  disabled={walk.isPending || (isChoice && chosen.length === 0)}
                  onClick={answer}
                >
                  {walk.isPending ? "Walking…" : "Answer and continue"}
                </button>
              </div>
            </>
          )}

          <div className="preview__toolbar">
            <button
              className="button"
              type="button"
              disabled={walk.isPending || steps.length === 0}
              onClick={() => walkTo(steps.slice(0, -1))}
            >
              Back one answer
            </button>
            {/* Never disabled on an empty walk, unlike "back": a routing
                fault refuses the very first call, and this is what asks
                again once it has been fixed in the other tab. */}
            <button
              className="button button--quiet"
              type="button"
              disabled={walk.isPending}
              onClick={() => walkTo([])}
            >
              {steps.length === 0 ? "Walk again" : "Start again"}
            </button>
          </div>
        </section>

        <section className="preview__path" aria-labelledby="preview-path">
          <h3 id="preview-path" className="panel__heading">
            The route so far
          </h3>
          {steps.length === 0 ? (
            <p className="empty">Nothing answered yet.</p>
          ) : (
            <ol className="preview__steps">
              {steps.map((step, index) => (
                <li key={`${step.question.id}-${String(index)}`}>
                  <code className="preview__code">{step.question.code}</code>
                  <span className="preview__answer">
                    {step.optionIds.length === 0
                      ? "no option selected"
                      : step.optionIds
                          .map(
                            (optionId) =>
                              step.question.options.find(
                                (option) => option.id === optionId,
                              )?.label ?? "unknown option",
                          )
                          .join(", ")}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
