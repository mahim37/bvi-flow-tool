import { useId, useRef, useState } from "react";
import type { RefObject } from "react";

import { useAddQuestion, useReview } from "../api/queries";
import type { AnswerType, Graph, UUID, VersionDiff } from "../api/types";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, nativeSelectClassName } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { answerTypeLabel } from "./labels";
import { checkRow } from "@/lib/chrome";
import { EditorDialog } from "./EditorDialog";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

const ANSWER_TYPES: AnswerType[] = [
  "single_choice",
  "multi_choice",
  "free_text",
  "scale",
];
const NO_SECTION = "__none__";
const NUMERIC_CODE = /^([Qq]?)(\d+)$/;

/**
 * Next unused question code on this version: increment the highest integer
 * already used (`24` -> `25`, `Q24` -> `Q25`), keeping that match's prefix.
 * No numeric codes -> `Q1` or `1` from the dominant existing prefix. An
 * empty graph starts at `1`.
 *
 * Purely slug codes (`risk_1`) are not a sequence, so they are ignored
 * when picking the next integer -- same as incrementing past the highest
 * numeric QID on a mixed graph.
 *
 * Retired draft-only questions still occupy the unique-code slot even
 * after `graph/` drops them, so callers must pass those codes too
 * (`usedQuestionCodes`).
 */
export function nextQuestionCode(codes: readonly string[]): string {
  let maxN = -1;
  let prefix = "";

  for (const code of codes) {
    const match = NUMERIC_CODE.exec(code.trim());
    if (match === null) continue;
    const n = Number(match[2]);
    if (n > maxN) {
      maxN = n;
      prefix = match[1] ?? "";
    }
  }

  if (maxN >= 0) return `${prefix}${maxN + 1}`;
  if (codes.length === 0) return "1";

  let qCount = 0;
  for (const code of codes) {
    if (/^[Qq]/.test(code.trim())) qCount += 1;
  }
  return qCount > codes.length - qCount ? "Q1" : "1";
}

/** Codes that still occupy `questionnaires_question_version_code_unique`,
 * including archived rows `graph/` omits when nothing points at them.
 * Review `key`s are the codes the diff matched on. */
export function usedQuestionCodes(
  graph: Graph,
  diff?: VersionDiff | null,
  extra: readonly string[] = [],
): string[] {
  const codes = new Set<string>(extra);
  for (const question of graph.questions) codes.add(question.code);
  if (diff != null) {
    for (const item of diff.questions) codes.add(item.key);
  }
  return [...codes];
}

interface AddQuestionProps {
  graph: Graph;
  /** Select the new question once it exists, so the next thing anybody
   * does -- point an edge at it -- is one click away. */
  onAdded: (questionId: UUID) => void;
  /** Extra occupied codes the live graph/diff might not have loaded yet. */
  reservedCodes?: readonly string[];
}

/**
 * Add a question. It will not be asked until an edge says so.
 *
 * That is the model working rather than a step this form forgot. Under
 * graph routing there is no positional fall-through, so a new question is
 * inert until something is deliberately pointed at it -- which is exactly
 * the property that stopped inserting a question from silently re-routing
 * every "continue". The map will report it as unreachable, and that report
 * is the tool telling the truth.
 */
export function AddQuestion({ graph, onAdded, reservedCodes }: AddQuestionProps) {
  const promptRef = useRef<HTMLTextAreaElement>(null);

  return (
    <EditorDialog
      title="Add a question"
      className="max-h-[min(90svh,44rem)] overflow-y-auto"
      trigger={<Button variant="outline">Add a question</Button>}
      initialFocus={promptRef}
    >
      {(close) => (
        <AddQuestionForm
          graph={graph}
          onAdded={onAdded}
          {...(reservedCodes !== undefined ? { reservedCodes } : {})}
          close={close}
          promptRef={promptRef}
        />
      )}
    </EditorDialog>
  );
}

function AddQuestionForm({
  graph,
  onAdded,
  reservedCodes = [],
  close,
  promptRef,
}: AddQuestionProps & {
  close: () => void;
  promptRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const addQuestion = useAddQuestion(versionId);
  const review = useReview(graph.version.is_draft ? versionId : null);

  const codeId = useId();
  const promptId = useId();
  const typeId = useId();
  const sectionId = useId();
  const requiredId = useId();

  const suggestedCode = nextQuestionCode(
    usedQuestionCodes(graph, review.data?.diff, reservedCodes),
  );
  const [codeOverride, setCodeOverride] = useState<string | null>(null);
  const code = codeOverride ?? suggestedCode;
  const [prompt, setPrompt] = useState("");
  const [answerType, setAnswerType] = useState<AnswerType>("single_choice");
  const [section, setSection] = useState<string>(NO_SECTION);
  const [isRequired, setIsRequired] = useState(true);

  const sections = [...graph.sections].sort(
    (left, right) => left.display_order - right.display_order,
  );
  const error = writeErrorMessage(addQuestion.error);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        addQuestion.mutate(
          {
            code,
            prompt,
            answer_type: answerType,
            is_required: isRequired,
            section: section === NO_SECTION ? null : section,
          },
          {
            onError: onWriteError,
            onSuccess: (created) => {
              close();
              onAdded(created.id);
            },
          },
        );
      }}
    >
      {error !== null && (
        <Banner tone="error" role="alert" className="mt-0">
          {error}
        </Banner>
      )}

      <Field label="QID" htmlFor={codeId}>
        <Input
          id={codeId}
          value={code}
          required
          placeholder="QID"
          {...(addQuestion.isPending ? { disabled: true } : {})}
          onChange={(event) => setCodeOverride(event.target.value)}
        />
      </Field>

      <Field label="Question text" htmlFor={promptId}>
        <Textarea
          ref={promptRef}
          id={promptId}
          rows={3}
          value={prompt}
          required
          {...(addQuestion.isPending ? { disabled: true } : {})}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </Field>

      <Field label="Answer type" htmlFor={typeId}>
        <select
          id={typeId}
          className={nativeSelectClassName}
          value={answerType}
          {...(addQuestion.isPending ? { disabled: true } : {})}
          onChange={(event) => setAnswerType(event.target.value as AnswerType)}
        >
          {ANSWER_TYPES.map((type) => (
            <option key={type} value={type}>
              {answerTypeLabel(type)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Section" htmlFor={sectionId}>
        <select
          id={sectionId}
          className={nativeSelectClassName}
          value={section}
          {...(addQuestion.isPending ? { disabled: true } : {})}
          onChange={(event) => setSection(event.target.value)}
        >
          <option value={NO_SECTION}>No section</option>
          {sections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>

      <div className={checkRow}>
        <input
          id={requiredId}
          type="checkbox"
          checked={isRequired}
          disabled={addQuestion.isPending}
          onChange={(event) => setIsRequired(event.target.checked)}
        />
        <label htmlFor={requiredId}>Required</label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          loading={addQuestion.isPending}
          disabled={code.trim() === "" || prompt.trim() === ""}
        >
          Add question
        </Button>
      </div>
    </form>
  );
}
