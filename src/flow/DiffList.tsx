import type { DiffKind, ItemDiff } from "../api/types";
import { diffChangeLabel, diffKindLabel, diffValue, fieldLabel } from "./labels";

interface DiffListProps {
  kind: DiffKind;
  items: ItemDiff[];
  /** Jump to this change's node on the map. Absent for a section, which
   * hangs off no question, and for a removed item whose question the draft
   * no longer contains -- `question_id` is null in both cases. */
  onShowOnMap: (questionId: string) => void;
  /** Open the Preview screen seeded with a real route to this change,
   * instead of the entry point -- same `question_id !== null` guard as
   * `onShowOnMap`, since there's equally nothing to walk to for those
   * two cases. */
  onPreviewFrom: (questionId: string) => void;
}

/**
 * One kind of change, listed.
 *
 * Grouped by kind rather than flattened, matching how `diffing` serves it
 * and how a reviewer reads it: added and removed questions are skimmed,
 * and the edge changes are read carefully, because those are the ones
 * that alter what a respondent is asked next.
 *
 * Every row is keyed by `code`, never by id -- the server matched them
 * that way, because a draft is a whole copy and an id comparison would
 * report the entire questionnaire as removed and re-added.
 */
export function DiffList({ kind, items, onShowOnMap, onPreviewFrom }: DiffListProps) {
  if (items.length === 0) return null;

  return (
    <section className="diff__group" aria-labelledby={`diff-${kind}`}>
      <h3 id={`diff-${kind}`} className="panel__heading">
        {diffKindLabel(kind)}
        <span className="diff__groupcount">{items.length}</span>
      </h3>
      <ul className="diff__items">
        {items.map((item) => (
          <li key={`${item.change}:${item.key}`} className="diff__item">
            <div className="diff__head">
              <span className={`diff__badge diff__badge--${item.change}`}>
                {diffChangeLabel(item.change)}
              </span>
              <code className="diff__key">{item.key}</code>
              {item.question_id !== null && (
                <>
                  <button
                    type="button"
                    className="link"
                    onClick={() => onShowOnMap(item.question_id as string)}
                  >
                    Show on map
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => onPreviewFrom(item.question_id as string)}
                  >
                    Preview from here
                  </button>
                </>
              )}
            </div>

            {item.fields.length > 0 && (
              // Only rendered for a change: an added or removed item has
              // no pair to show, and listing every one of its fields
              // against "not set" would bury the four that a reviewer
              // actually has to read.
              <dl className="diff__fields">
                {item.fields.map((field) => (
                  <div key={field.field} className="diff__field">
                    <dt>{fieldLabel(field.field)}</dt>
                    <dd>
                      <span className="diff__before">{diffValue(field.base)}</span>
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only">changed to</span>
                      <span className="diff__after">{diffValue(field.draft)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
