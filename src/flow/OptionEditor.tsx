import { useId, useMemo, useState } from "react";

import {
  useAddOption,
  useRemoveOption,
  useReorderOptions,
  useUpdateOption,
} from "../api/queries";
import { CHOICE_ANSWER_TYPES } from "../api/types";
import type { Graph, Question, QuestionOption, UUID } from "../api/types";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

interface OptionEditorProps {
  graph: Graph;
  question: Question;
  editable: boolean;
}

interface OptionRowProps {
  versionId: UUID;
  option: QuestionOption;
  /** Reported by the server, so the fault and the map agree about which
   * answer leads nowhere. */
  isUncovered: boolean;
  /** True while an edge is guarded by this option. Deleting it is refused
   * rather than cascading, so the control says why in advance. */
  isGuard: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  disabled: boolean;
}

function OptionRow({
  versionId,
  option,
  isUncovered,
  isGuard,
  canMoveUp,
  canMoveDown,
  onMove,
  disabled,
}: OptionRowProps) {
  const onWriteError = useWriteErrorHandler();
  const updateOption = useUpdateOption(versionId);
  const removeOption = useRemoveOption(versionId);

  const labelId = useId();
  const codeId = useId();
  const [label, setLabel] = useState(option.label);
  const [code, setCode] = useState(option.code);

  const dirty = label !== option.label || code !== option.code;
  const pending = updateOption.isPending || removeOption.isPending || disabled;
  const error =
    writeErrorMessage(updateOption.error) ?? writeErrorMessage(removeOption.error);

  return (
    <li className="optedit">
      <div className="optedit__fields">
        <div className="field field--inline">
          <label htmlFor={labelId}>Label</label>
          <input
            id={labelId}
            value={label}
            disabled={pending}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div className="field field--inline">
          <label htmlFor={codeId}>Code</label>
          <input
            id={codeId}
            value={code}
            disabled={pending}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
      </div>

      {isUncovered && (
        <p className="options__fault">
          No edge covers this answer, so choosing it ends the flow.
        </p>
      )}

      <div className="optedit__controls">
        <button
          className="button button--primary"
          type="button"
          disabled={pending || !dirty}
          onClick={() =>
            updateOption.mutate(
              {
                optionId: option.id,
                // Only what moved: an absent key stays absent from
                // `validated_data`, and the code of an inherited option is
                // refused outright, so sending an unchanged one would turn
                // a label edit into a refusal.
                changes: {
                  ...(label !== option.label ? { label } : {}),
                  ...(code !== option.code ? { code } : {}),
                },
              },
              { onError: onWriteError },
            )
          }
        >
          Save
        </button>
        <button
          className="button button--quiet"
          type="button"
          disabled={pending || !canMoveUp}
          onClick={() => onMove(-1)}
        >
          Up
        </button>
        <button
          className="button button--quiet"
          type="button"
          disabled={pending || !canMoveDown}
          onClick={() => onMove(1)}
        >
          Down
        </button>
        <button
          className="button button--danger"
          type="button"
          disabled={pending || isGuard}
          title={
            isGuard
              ? "An edge is guarded by this option. Deleting it would silently un-route whatever that answer led to, so remove the edge first."
              : undefined
          }
          onClick={() => removeOption.mutate(option.id, { onError: onWriteError })}
        >
          Delete
        </button>
      </div>

      {isGuard && (
        // Refused rather than cascaded, and the edge may leave another
        // question entirely -- the dead-edge case the draft copy
        // deliberately preserves.
        <p className="panel__hint">
          An edge is guarded by this option, so deleting it is refused. Remove that edge
          first.
        </p>
      )}

      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function OptionEditor({ graph, question, editable }: OptionEditorProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const addOption = useAddOption(versionId);
  const reorderOptions = useReorderOptions(versionId);

  const codeId = useId();
  const labelId = useId();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");

  const options = useMemo(
    () =>
      [...question.options].sort(
        (left, right) => left.display_order - right.display_order,
      ),
    [question.options],
  );

  const uncovered = useMemo(
    () => new Set(question.diagnostics?.uncovered_option_ids ?? []),
    [question.diagnostics],
  );

  // Guards from anywhere in the version, not just from this question. An
  // edge leaving another question can be guarded by an option this one
  // owns -- that is precisely the dead edge the map reports -- and the
  // delete refusal covers both.
  const guardOptionIds = useMemo(
    () =>
      new Set(
        graph.edges
          .map((edge) => edge.from_option)
          .filter((optionId): optionId is UUID => optionId !== null),
      ),
    [graph.edges],
  );

  // Nothing selects an option on a free-text or scale question, so the
  // server refuses adding one: the row would be inert, and the only thing
  // it could become is the dead-edge report the map exists to flag.
  const takesOptions = CHOICE_ANSWER_TYPES.has(question.answer_type);

  const pending = addOption.isPending || reorderOptions.isPending;
  const error =
    writeErrorMessage(addOption.error) ?? writeErrorMessage(reorderOptions.error);

  function move(index: number, direction: -1 | 1) {
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= options.length) return;
    const ordered = options.map((item) => item.id);
    const here = ordered[index];
    const there = ordered[swapWith];
    if (here === undefined || there === undefined) return;
    ordered[index] = there;
    ordered[swapWith] = here;
    // Whole-list, like every other reorder here: the unique index on
    // (question, display_order) is checked per row, so a swap sent as two
    // writes fails halfway.
    reorderOptions.mutate(
      { questionId: question.id, optionIds: ordered },
      { onError: onWriteError },
    );
  }

  if (!editable) return null;

  return (
    <section className="panel__section" aria-labelledby="option-editor">
      <h3 id="option-editor" className="panel__heading">
        Edit options
      </h3>

      {options.length === 0 ? (
        <p className="empty">This question offers no options.</p>
      ) : (
        <ul className="optedits">
          {options.map((option, index) => (
            <OptionRow
              key={option.id}
              versionId={versionId}
              option={option}
              isUncovered={uncovered.has(option.id)}
              isGuard={guardOptionIds.has(option.id)}
              canMoveUp={index > 0}
              canMoveDown={index < options.length - 1}
              onMove={(direction) => move(index, direction)}
              disabled={pending}
            />
          ))}
        </ul>
      )}

      {takesOptions ? (
        <form
          className="editor"
          onSubmit={(event) => {
            event.preventDefault();
            addOption.mutate(
              { question: question.id, code, label },
              {
                onError: onWriteError,
                onSuccess: () => {
                  setCode("");
                  setLabel("");
                },
              },
            );
          }}
        >
          <h4 className="panel__subheading">Add an option</h4>
          <div className="field field--inline">
            <label htmlFor={labelId}>Label</label>
            <input
              id={labelId}
              value={label}
              required
              placeholder="What a respondent reads"
              disabled={pending}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="field field--inline">
            <label htmlFor={codeId}>Code</label>
            <input
              id={codeId}
              value={code}
              required
              placeholder="Stable identifier"
              disabled={pending}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button
            className="button button--primary"
            type="submit"
            disabled={pending || code.trim() === "" || label.trim() === ""}
          >
            {addOption.isPending ? "Adding…" : "Add option"}
          </button>
          {/* Appended, never inserted: a unique constraint on
              (question, display_order) makes an insertion a renumbering,
              which is what the up/down controls above do. */}
          <p className="panel__hint">
            Added last. A new option with no edge covering it is an answer that ends the
            flow — the map reports that, and it is not refused, because options are
            added before the edges that route them.
          </p>
        </form>
      ) : (
        <p className="panel__hint">
          Answers to a {question.answer_type.replace("_", " ")} question select no
          option, so adding one is refused: the row would be inert, and the only thing
          it could become is a dead edge.
        </p>
      )}

      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
