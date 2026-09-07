import { useId, useState } from "react";

import { useAddQuestion } from "../api/queries";
import type { AnswerType, Graph, UUID } from "../api/types";
import { EditorDropdown } from "./EditorDropdown";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, nativeSelectClassName } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { answerTypeLabel } from "./labels";
import { checkRow, editorBox, mutedHint } from "@/lib/chrome";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

const ANSWER_TYPES: AnswerType[] = [
  "single_choice",
  "multi_choice",
  "free_text",
  "scale",
];
const NO_SECTION = "__none__";

interface AddQuestionProps {
  graph: Graph;
  /** Select the new question once it exists, so the next thing anybody
   * does -- point an edge at it -- is one click away. */
  onAdded: (questionId: UUID) => void;
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
export function AddQuestion({ graph, onAdded }: AddQuestionProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const addQuestion = useAddQuestion(versionId);

  const codeId = useId();
  const promptId = useId();
  const typeId = useId();
  const sectionId = useId();
  const requiredId = useId();
  const rawId = useId();

  const [code, setCode] = useState("");
  const [prompt, setPrompt] = useState("");
  const [answerType, setAnswerType] = useState<AnswerType>("single_choice");
  const [section, setSection] = useState<string>(NO_SECTION);
  const [isRequired, setIsRequired] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  const sections = [...graph.sections].sort(
    (left, right) => left.display_order - right.display_order,
  );
  const error = writeErrorMessage(addQuestion.error);

  return (
    <EditorDropdown trigger="Add a question">
      {(close) => (
        <>
          <form
            className={editorBox}
            onSubmit={(event) => {
              event.preventDefault();
              addQuestion.mutate(
                {
                  code,
                  prompt,
                  answer_type: answerType,
                  is_required: isRequired,
                  section: section === NO_SECTION ? null : section,
                  show_raw_answer_to_advisor: showRaw,
                },
                {
                  onError: onWriteError,
                  onSuccess: (created) => {
                    close();
                    setCode("");
                    setPrompt("");
                    onAdded(created.id);
                  },
                },
              );
            }}
          >
            <Field label="QID" htmlFor={codeId}>
              <Input
                id={codeId}
                value={code}
                required
                placeholder="Stable identifier"
                {...(addQuestion.isPending ? { disabled: true } : {})}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>

            <Field label="Question text" htmlFor={promptId}>
              <Textarea
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

            {/* Offered here and nowhere else. `FlowToolQuestionSerializer` does
            not serve `show_raw_answer_to_advisor`, so an existing
            question's value cannot be read back -- an edit control would
            have to start from a guess and would silently overwrite whatever
            was really set. On a question being created there is no prior
            value to misreport. */}
            <div className={checkRow}>
              <input
                id={rawId}
                type="checkbox"
                checked={showRaw}
                disabled={addQuestion.isPending}
                onChange={(event) => setShowRaw(event.target.checked)}
              />
              <label htmlFor={rawId}>Show the raw answer to advisors</label>
            </div>

            <Button
              variant="primary"
              type="submit"
              disabled={
                addQuestion.isPending || code.trim() === "" || prompt.trim() === ""
              }
            >
              {addQuestion.isPending ? "Adding…" : "Add question"}
            </Button>

            <p className={mutedHint}>
              Added last, and unreachable until an edge points at it. Use the detail
              panel of the question it should follow to add that edge, and the position
              controls there to move it.
            </p>
          </form>

          {error !== null && (
            <Banner tone="error" role="alert">
              {error}
            </Banner>
          )}
        </>
      )}
    </EditorDropdown>
  );
}
