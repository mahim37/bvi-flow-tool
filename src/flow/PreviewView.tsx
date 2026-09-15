import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import predmindLogo from "../assets/predmind-logo.webp";
import { ApiError } from "../api/client";
import { usePreviewPathTo, usePreviewWalk, useReview } from "../api/queries";
import { CHOICE_ANSWER_TYPES } from "../api/types";
import type {
  PreviewAnswer,
  PreviewRegion,
  PreviewState,
  QuestionRecord,
  UUID,
} from "../api/types";
import { useAuth } from "../auth/useAuth";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingStatus } from "@/components/ui/loading";
import { Segment, SegmentOption } from "@/components/ui/segment";
import { useVersionContext } from "./versionContext";
import { previewInstruction, regionLabel } from "./labels";
import { emptyText, panelHeading } from "@/lib/chrome";
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
  const [regionIndex, setRegionIndex] = useState(0);

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

  // Changes-only mode's grouping, computed server-side
  // (`preview_regions.py`) so "consecutive" reflects the graph's real
  // branching -- adjacency along `routing.path_to`'s own route to each
  // question, not `display_order`, which is presentational under GRAPH
  // routing and can disagree with it once branches are involved. Each
  // region is a contiguous run of one or more changed questions, plus the
  // one unchanged question immediately before it, if any.
  const regions = review.data?.preview_regions ?? [];

  // A published version keeps its historical diff forever (that's what
  // "What changed" shows), but by the time it's live those changes are
  // just what the questionnaire already is -- there is nothing left to
  // step through as a "change," so this mode only applies to a proposal
  // that hasn't published yet. Reads `graph.change_request` too: it goes
  // null the moment a version stops being a draft, before `review.data`
  // itself would necessarily reflect that.
  const changeRequestStatus =
    (review.data?.change_request ?? graph.change_request)?.status ?? null;
  const hasChanges = regions.length > 0 && changeRequestStatus !== "published";
  // Defaults to "changes" the moment there is anything to show -- explicit
  // requirement, not just a convenience: a reviewer opening Preview should
  // land on what this draft actually touches, not have to know to ask for
  // it. Falls back to "full" with nothing to override it once a change
  // exists (nothing to step through), regardless of any earlier toggle.
  const mode: PreviewMode = hasChanges ? (modeOverride ?? "changes") : "full";

  // `ReviewView`'s "Preview from here" points at one specific question via
  // `?question=`; this resolves it to whichever region contains that
  // question exactly once, the first time the diff is available to check
  // it against -- afterward the reviewer's own Next/Previous clicks own
  // `regionIndex`, so this must not re-fire and snap them back.
  const appliedUrlTargetRef = useRef(false);
  useEffect(() => {
    if (appliedUrlTargetRef.current || review.data === undefined) return;
    appliedUrlTargetRef.current = true;
    const urlTarget = searchParams.get("question");
    if (urlTarget === null) return;
    const index = regions.findIndex((region) => region.question_ids.includes(urlTarget));
    if (index !== -1) {
      setModeOverride("changes");
      setRegionIndex(index);
    }
  }, [review.data, searchParams, regions]);

  // Restarted whenever the version, the mode, or which region is being
  // stepped to changes. Deliberately *not* keyed on `graph`/`regions`
  // themselves, which change identity on every unrelated refetch (any edit
  // anywhere invalidates the graph) -- this still re-seeds exactly when it
  // should, because `review.data` transitioning from unloaded to loaded is
  // what makes those two actually differ in the first place.
  useEffect(() => {
    if (review.data === undefined) return;
    setSteps([]);
    setState(null);
    setChosen([]);
    setFreeValue("");

    // Seeds to the region's *first* question only -- same mechanism as
    // before, just landing on the start of a run instead of one isolated
    // question. Everything after that is the reviewer's own real answers;
    // `pastRegion` below is what notices once those answers have carried
    // them out the other side.
    const target = mode === "changes" ? regions[regionIndex]?.question_ids[0] : undefined;
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
  }, [versionId, review.data, mode, regionIndex, mutate]);

  const currentRegion: PreviewRegion | null =
    mode === "changes" ? (regions[regionIndex] ?? null) : null;

  const question = state?.next_questions[0] ?? null;
  const isChoice = question !== null && CHOICE_ANSWER_TYPES.has(question.answer_type);
  const isMulti = question?.answer_type === "multi_choice";
  // The reviewer's own real answers have carried the walk out the far
  // side of the region -- `question` is a question of trailing context
  // this lands on, not something to precompute server-side (see
  // `preview_regions.py`'s own docstring for why): it falls out of
  // whatever they actually picked, same as it would for a respondent.
  const pastRegion =
    mode === "changes" &&
    currentRegion !== null &&
    question !== null &&
    !currentRegion.question_ids.includes(question.id);
  // How many already-answered steps in a row, counting back from the most
  // recent, sit outside the region -- stops counting the moment it hits a
  // step that *is* a region member (or runs out of steps). Zero right
  // after finishing the region itself, since every trailing step at that
  // point is still a region member; becomes 1 the moment the reviewer
  // answers the one unaffected question this lands them on next.
  let pastRegionCount = 0;
  if (currentRegion !== null) {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const step = steps[i];
      if (step === undefined || currentRegion.question_ids.includes(step.question.id)) {
        break;
      }
      pastRegionCount += 1;
    }
  }
  // "One unchanged question on either side of the change" (spec) -- the
  // seed already only auto-walks through the one right before the region;
  // this is what holds the line on the other side once answering is real
  // again. The first unaffected question is still a genuine step to
  // confirm the change rejoins correctly; a second one in a row is
  // Changes-only mode wandering into unrelated territory, which is what
  // Full preview is for.
  const pastRegionLimitReached = pastRegion && pastRegionCount >= 1;
  const regionBannerMessage = pastRegionLimitReached ? (
    "That's as far as Changes-only mode walks past a change — use Next to " +
    "preview the next one, or switch to Full preview to keep going."
  ) : pastRegion ? (
    "Unaffected by this change — answer it to see it connects correctly, " +
    "or use Next to preview the next change."
  ) : currentRegion !== null ? (
    <>
      Previewing <strong>{regionLabel(currentRegion, graph.questions)}</strong>
    </>
  ) : null;

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
    <main className="page--preview min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-15">
      <header className="mb-2.5 flex items-center gap-4">
        <h2 className="m-0 text-[1.3rem] font-extrabold tracking-tight">Preview</h2>

        {hasChanges && (
          // Preview mode is the Segment primitive — Button options on a
          // shared track, not a second control that happens to look similar.
          <Segment
            className="shrink-0"
            label="Preview mode"
            value={mode}
            onValueChange={(next) => setModeOverride(next as PreviewMode)}
          >
            <SegmentOption value="changes">Changes only</SegmentOption>
            <SegmentOption value="full">Full preview</SegmentOption>
          </Segment>
        )}
      </header>

      {mode === "changes" && currentRegion !== null && (
        <Banner as="div" tone="warn" className="preview__changebar" role="status">
          <p>
            <strong className="preview__changelabel">
              Change {regionIndex + 1} of {regions.length}
            </strong>
            . {regionBannerMessage}
          </p>
          <div className="preview__changenav">
            <Button
              variant="outline"
              disabled={regionIndex === 0}
              onClick={() => setRegionIndex((index) => index - 1)}
            >
              ← Previous
            </Button>
            <Button
              variant="primary"
              disabled={regionIndex >= regions.length - 1}
              onClick={() => setRegionIndex((index) => index + 1)}
            >
              Next →
            </Button>
          </div>
        </Banner>
      )}

      {/* `mode === "changes"` too: `pathTo` is only ever called from the
          seeding effect in that mode, so a failure it left behind must not
          keep showing once the reviewer switches to Full preview -- that
          mutation's own state isn't reset just because the mode changed. */}
      {mode === "changes" && pathError !== null && (
        <Banner tone="error" role="alert">
          {pathError}
        </Banner>
      )}

      {conflict && (
        // Not an error to apologise for: a cycle or a dangling target is
        // the crash a respondent would get, found by somebody who can
        // still fix it. That is the feature.
        <Banner tone="error" role="alert">
          <strong>The routing is broken here.</strong> {walk.error?.message} A
          respondent reaching this point would get an error rather than a question. Fix
          it on the map and walk again.
        </Banner>
      )}

      {walk.isError && !conflict && (
        <Banner tone="error" role="alert">
          {walk.error instanceof Error
            ? walk.error.message
            : "Could not walk this version."}
        </Banner>
      )}

      {/* Full preview only: the denominator is every question reachable
          from the entry point, which means little in Changes-only mode --
          a region can seed straight into the middle of the flow, where
          "12 of 82 answered" reads as behind rather than as exactly where
          this change sits. The change banner above is Changes-only mode's
          own progress indicator. */}
      {mode === "full" && state !== null && (
        <p className="preview__progress" role="status">
          {state.answered_count} of {state.total_count} answered
          {/* The denominator is the questions reachable from the entry
              point, not every question in the version: an unreachable one
              is never served, so counting it would make a completed walk
              look unfinished. */}
          <span className="preview__progressnote">
            {" "}
            of the questions reachable from the entry point
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
              {state === null && walk.isPending && (
                <LoadingStatus className={emptyText}>Starting…</LoadingStatus>
              )}

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

                  {pastRegionLimitReached ? (
                    // Second unaffected question in a row -- past the one
                    // side of context Changes-only mode shows. Read-only
                    // rather than another step to answer: "Next" above (or
                    // Full preview) is how a reviewer keeps going from
                    // here.
                    <p className="preview__subtitle">Unaffected by this change.</p>
                  ) : isChoice ? (
                    <>
                      <p className="preview__subtitle">
                        {previewInstruction(question.answer_type)}
                        {question.is_required
                          ? ""
                          : " Optional. You can continue without picking one."}
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
                                <code className="text-muted-foreground ml-2 font-mono text-[0.75rem]">
                                  {option.code}
                                </code>
                              </label>
                            </li>
                          );
                        })}
                        {question.options.length === 0 && (
                          <li className={emptyText}>
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
                      <Input
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

                  {!pastRegionLimitReached && (
                    <div className="preview__actions">
                      <Button
                        variant="primary"
                        className="preview__next"
                        loading={walk.isPending}
                        disabled={isChoice && chosen.length === 0}
                        onClick={answer}
                      >
                        Answer and continue
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="preview__toolbar">
            <Button
              disabled={walk.isPending || steps.length === 0}
              onClick={() => walkTo(steps.slice(0, -1))}
            >
              Back one answer
            </Button>
            {/* Never disabled on an empty walk, unlike "back": a routing
                fault refuses the very first call, and this is what asks
                again once it has been fixed in the other tab. */}
            <Button
              variant="ghost"
              disabled={walk.isPending}
              onClick={() => walkTo([])}
            >
              {steps.length === 0 ? "Walk again" : "Start again"}
            </Button>
          </div>
        </section>

        {mode === "full" && (
          // Not shown in "changes" mode: the route there is a computed
          // path to the change being reviewed, not something the reviewer
          // built answer by answer, so listing it back reads as "what did
          // I just pick" rather than "here's how you'd actually reach
          // this" -- the Change N of M banner above already says that.
          <section className="preview__path" aria-labelledby="preview-path">
            <h3 id="preview-path" className={panelHeading}>
              The route so far
            </h3>
            {steps.length === 0 ? (
              <p className={emptyText}>Nothing answered yet.</p>
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
