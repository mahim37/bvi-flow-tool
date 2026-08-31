import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import predmindLogo from "../assets/predmind-logo.webp";
import { ApiError } from "../api/client";
import { usePreviewPathTo, usePreviewWalk, useReview } from "../api/queries";
import { CHOICE_ANSWER_TYPES } from "../api/types";
import type { PreviewAnswer, PreviewState, QuestionRecord, UUID } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { useVersionContext } from "./versionContext";
import { previewInstruction, questionRefLabel } from "./labels";
import { writeErrorMessage } from "./useWriteError";

type PreviewMode = "full" | "changes";

/** What the walk stood on, so a reader can see the route rather than just
 * where it ended. Kept beside the answers because the payload names only
 * the *next* question -- a question already answered has left the walk.
 * `freeValue` is display-only, same as the input it comes from (see the
 * free-text/scale branch below) -- never sent to `walk`, since the
 * resolver's routing for these types doesn't depend on it either. */
interface Step {
  question: QuestionRecord;
  optionIds: UUID[];
  freeValue: string | null;
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
  const { noteApiError } = useAuth();
  const walk = usePreviewWalk(versionId as UUID);
  const pathTo = usePreviewPathTo(versionId as UUID);
  const review = useReview(versionId ?? null);
  const [searchParams] = useSearchParams();

  const [steps, setSteps] = useState<Step[]>([]);
  const [state, setState] = useState<PreviewState | null>(null);
  const [chosen, setChosen] = useState<UUID[]>([]);
  const [freeValue, setFreeValue] = useState("");
  // `null` until the reviewer explicitly flips the toggle -- until then,
  // the mode is *derived* (see `mode` below) rather than chosen, so a
  // toggle that later loses its changes (this draft got edited further)
  // does not leave a stale explicit choice pinning it to a mode that no
  // longer makes sense.
  const [modeOverride, setModeOverride] = useState<PreviewMode | null>(null);
  const [changeIndex, setChangeIndex] = useState(0);

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
          setFreeValue("");
        },
      });
    },
    [mutate],
  );

  // Every question this draft touches, deduped and in reading order (a
  // question's own `display_order`, not diff-kind order) -- sections
  // contribute nothing here, since a section change hangs off no single
  // question. "Changes only" mode steps through exactly this list.
  //
  // A *removed* question still has a `question_id` in `diff.questions`,
  // but it no longer exists in `graph.questions` to preview a path to --
  // stepping to one 404s server-side ("No Question matches the given
  // query."), so it's filtered out here rather than left for the walk to
  // fail on.
  const changedQuestionIds = useMemo(() => {
    if (review.data === undefined) return [];
    const { diff } = review.data;
    const liveIds = new Set(graph.questions.map((question) => question.id));
    const ids = new Set<UUID>();
    for (const item of [...diff.questions, ...diff.options, ...diff.edges]) {
      if (item.question_id !== null && liveIds.has(item.question_id)) {
        ids.add(item.question_id);
      }
    }
    return [...ids].sort((a, b) => {
      const orderOf = (id: UUID) =>
        graph.questions.find((question) => question.id === id)?.display_order ?? 0;
      return orderOf(a) - orderOf(b);
    });
  }, [review.data, graph.questions]);

  // A published version keeps its historical diff forever (that's what
  // "What changed" shows), but by the time it's live those changes are
  // just what the questionnaire already is -- there is nothing left to
  // step through as a "change," so this mode only applies to a proposal
  // that hasn't published yet. Reads `graph.change_request` too: it goes
  // null the moment a version stops being a draft, before `review.data`
  // itself would necessarily reflect that.
  const changeRequestStatus =
    (review.data?.change_request ?? graph.change_request)?.status ?? null;
  const hasChanges =
    changedQuestionIds.length > 0 && changeRequestStatus !== "published";
  // Defaults to "changes" the moment there is anything to show -- explicit
  // requirement, not just a convenience: a reviewer opening Preview should
  // land on what this draft actually touches, not have to know to ask for
  // it. Falls back to "full" with nothing to override it once a change
  // exists (nothing to step through), regardless of any earlier toggle.
  const mode: PreviewMode = hasChanges ? (modeOverride ?? "changes") : "full";

  // `ReviewView`'s "Preview from here" points at one specific change via
  // `?question=`; this resolves it to a position in `changedQuestionIds`
  // exactly once, the first time the diff is available to check it
  // against -- afterward the reviewer's own Next/Previous clicks own
  // `changeIndex`, so this must not re-fire and snap them back.
  const appliedUrlTargetRef = useRef(false);
  useEffect(() => {
    if (appliedUrlTargetRef.current || review.data === undefined) return;
    appliedUrlTargetRef.current = true;
    const urlTarget = searchParams.get("question");
    if (urlTarget === null) return;
    const index = changedQuestionIds.indexOf(urlTarget);
    if (index !== -1) {
      setModeOverride("changes");
      setChangeIndex(index);
    }
  }, [review.data, searchParams, changedQuestionIds]);

  // Restarted whenever the version, the mode, or which change is being
  // stepped to changes. Deliberately *not* keyed on `graph`/
  // `changedQuestionIds` themselves, which change identity on every
  // unrelated refetch (any edit anywhere invalidates the graph) -- this
  // still re-seeds exactly when it should, because `review.data`
  // transitioning from unloaded to loaded is what makes those two actually
  // differ in the first place.
  useEffect(() => {
    if (review.data === undefined) return;
    setSteps([]);
    setState(null);
    setChosen([]);
    setFreeValue("");

    const target = mode === "changes" ? changedQuestionIds[changeIndex] : undefined;
    if (target === undefined) {
      mutate([], { onSuccess: (result) => setState(result) });
      return;
    }

    pathTo.mutate(target, {
      onError: noteApiError,
      onSuccess: (path) => {
        // The path was computed against this same graph moments ago, so
        // every question in it should still resolve -- but fall back to
        // an unseeded walk rather than throw if a concurrent edit removed
        // one from under it.
        const seededSteps: Step[] = [];
        for (const answer of path.answers) {
          const found = graph.questions.find((item) => item.id === answer.question_id);
          if (found === undefined) {
            mutate([], { onSuccess: (result) => setState(result) });
            return;
          }
          seededSteps.push({
            question: found,
            optionIds: answer.option_ids,
            freeValue: null,
          });
        }
        walkTo(seededSteps);
      },
    });
  }, [versionId, review.data, mode, changeIndex, mutate]);

  const currentChange =
    mode === "changes"
      ? (graph.questions.find((item) => item.id === changedQuestionIds[changeIndex]) ??
        null)
      : null;

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
    walkTo([
      ...steps,
      {
        question,
        optionIds: chosen,
        freeValue: isChoice ? null : freeValue.trim() || null,
      },
    ]);
  }

  const conflict = walk.error instanceof ApiError && walk.error.isConflict;
  const pathError = writeErrorMessage(pathTo.error);

  return (
    <main className="page page--preview">
      <header className="page__header page__header--preview">
        <h2 className="page__title">Preview</h2>

        {hasChanges && (
          // Ported from break-backend's own `.seg` segmented toggle
          // (styles.css ~L229-257, same padding/radius/shadow values) --
          // this app's one other place two mutually-exclusive views need
          // picking between. "Changes only" is the default the moment
          // there is anything to show (see `mode` above); this is what
          // lets a reviewer switch back to the ordinary entry-point walk.
          <div
            className="seg preview__modeswitch"
            role="group"
            aria-label="Preview mode"
          >
            <button
              type="button"
              className={mode === "changes" ? "active" : ""}
              onClick={() => setModeOverride("changes")}
            >
              Changes only
            </button>
            <button
              type="button"
              className={mode === "full" ? "active" : ""}
              onClick={() => setModeOverride("full")}
            >
              Full preview
            </button>
          </div>
        )}
      </header>

      {mode === "changes" && currentChange !== null && (
        <div className="banner banner--info preview__changebar" role="status">
          <p>
            Change {changeIndex + 1} of {changedQuestionIds.length} — previewing{" "}
            <strong>QID {questionRefLabel(currentChange)}</strong>
          </p>
          <div className="preview__changenav">
            <button
              type="button"
              className="opt-edit-btn"
              disabled={changeIndex === 0}
              onClick={() => setChangeIndex((index) => index - 1)}
            >
              ← Previous
            </button>
            <button
              type="button"
              className="opt-edit-btn"
              disabled={changeIndex >= changedQuestionIds.length - 1}
              onClick={() => setChangeIndex((index) => index + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* `mode === "changes"` too: `pathTo` is only ever called from the
          seeding effect in that mode, so a failure it left behind must not
          keep showing once the reviewer switches to Full preview -- that
          mutation's own state isn't reset just because the mode changed. */}
      {mode === "changes" && pathError !== null && (
        <p className="banner banner--error" role="alert">
          {pathError}
        </p>
      )}

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

      <div
        className={
          mode === "changes" ? "preview__body preview__body--solo" : "preview__body"
        }
      >
        <section className="preview__current" aria-labelledby="preview-question">
          <div className="preview__stage">
            {/* Ported from break-backend's own preview walkthrough
                (question_graph_editor's `.preview-stage`/`.preview-logo`) --
                the respondent's own logo, not this tool's admin chrome, so
                this reads as what a respondent would actually be shown. Its
                own column rather than a stacked line above the question, so
                it reads as branding beside the content, not a header on top
                of it. */}
            <div className="preview__logocol">
              <img className="preview__logo" src={predmindLogo} alt="Predmind" />
            </div>

            <div className="preview__content">
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
                        {previewInstruction(question.answer_type)}
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
                            This question offers no options, so nothing can be selected
                            and only a question-level edge can fire.
                          </li>
                        )}
                      </ul>
                    </>
                  ) : (
                    // Ported from break-backend's own preview (NUMBER vs
                    // everything else gets `type="number"`/`"text"`) --
                    // shown for realism only, same as there: a free-text or
                    // scale answer selects no option, so nothing typed here
                    // changes the route. It is echoed back in "The route so
                    // far" below, though, so a reviewer can see what they
                    // typed rather than a flat "no option selected".
                    <>
                      <p className="preview__subtitle">
                        {previewInstruction(question.answer_type)}
                      </p>
                      <input
                        key={question.id}
                        className="preview__freetext"
                        type={question.answer_type === "scale" ? "number" : "text"}
                        placeholder={
                          question.answer_type === "scale"
                            ? "Enter a number"
                            : "Enter your response"
                        }
                        value={freeValue}
                        onChange={(event) => setFreeValue(event.target.value)}
                      />
                    </>
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
            </div>
          </div>

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

        {mode === "full" && (
          // Not shown in "changes" mode: the route there is a computed
          // path to the change being reviewed, not something the reviewer
          // built answer by answer, so listing it back reads as "what did
          // I just pick" rather than "here's how you'd actually reach
          // this" -- the Change N of M banner above already says that.
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
                      {step.optionIds.length > 0
                        ? step.optionIds
                            .map(
                              (optionId) =>
                                step.question.options.find(
                                  (option) => option.id === optionId,
                                )?.label ?? "unknown option",
                            )
                            .join(", ")
                        : (step.freeValue ?? "no option selected")}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
