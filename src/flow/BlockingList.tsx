import type { UUID } from "../api/types";

export interface BlockingQuestionItem {
  questionId: UUID;
  code: string;
  prompt: string;
}

/** What a delete refusal is actually blocked by, each one a link straight
 * to it -- so "3 things are still filed here" is somewhere to go, not
 * just a number. Used by `Options.tsx` for `OptionGuardedError`, the
 * refusal the server names specifically rather than just counting. */
export function BlockingList({
  items,
  onSelectQuestion,
}: {
  items: readonly BlockingQuestionItem[];
  onSelectQuestion: (id: UUID) => void;
}) {
  return (
    <ul className="blockers">
      {items.map((item) => (
        <li key={item.questionId}>
          <button
            type="button"
            className="link"
            onClick={() => onSelectQuestion(item.questionId)}
          >
            {item.code}
          </button>
          <span className="blockers__prompt">{item.prompt}</span>
        </li>
      ))}
    </ul>
  );
}
