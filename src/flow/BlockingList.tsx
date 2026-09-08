import type { UUID } from "../api/types";
import { Button } from "@/components/ui/button";

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
    <ul className="mt-2 flex list-none flex-col gap-1 p-0">
      {items.map((item) => (
        <li key={item.questionId} className="flex flex-wrap items-baseline gap-1.5">
          <Button variant="link" onClick={() => onSelectQuestion(item.questionId)}>
            {item.code}
          </Button>
          <span className="text-[0.85rem] opacity-85">{item.prompt}</span>
        </li>
      ))}
    </ul>
  );
}
