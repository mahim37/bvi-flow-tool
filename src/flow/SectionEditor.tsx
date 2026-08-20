import { useId, useState } from "react";

import { useAddSection, useRemoveSection, useUpdateSection } from "../api/queries";
import type { Graph, Section } from "../api/types";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

interface SectionRowProps {
  graph: Graph;
  section: Section;
}

/**
 * One heading, editable in place.
 *
 * `display_order` is written directly here, unlike a question's or an
 * option's. `Section.display_order` carries no unique constraint --
 * deliberately, per its own docstring -- so there is no slot to collide
 * with and no whole-list reorder verb to route through.
 */
function SectionRow({ graph, section }: SectionRowProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const updateSection = useUpdateSection(versionId);
  const removeSection = useRemoveSection(versionId);

  const nameId = useId();
  const codeId = useId();
  const orderId = useId();
  const descriptionId = useId();

  const [name, setName] = useState(section.name);
  const [code, setCode] = useState(section.code);
  const [description, setDescription] = useState(section.description);
  const [displayOrder, setDisplayOrder] = useState(String(section.display_order));

  const parsedOrder = Number.parseInt(displayOrder, 10);
  const orderIsValid = Number.isFinite(parsedOrder);

  const changes = {
    ...(name !== section.name ? { name } : {}),
    ...(code !== section.code ? { code } : {}),
    ...(description !== section.description ? { description } : {}),
    ...(orderIsValid && parsedOrder !== section.display_order
      ? { display_order: parsedOrder }
      : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  const pending = updateSection.isPending || removeSection.isPending;
  const error =
    writeErrorMessage(updateSection.error) ?? writeErrorMessage(removeSection.error);

  // Filed questions block the delete, and the server refuses rather than
  // orphaning them. This count is a hint and not a gate: `graph/` serves
  // an archived question only while something still points at it, so a
  // section holding nothing but a forgotten archived question reads as
  // empty here and is refused anyway. Disabling on a number that can be
  // too low would leave a dead button with nothing to explain it, so the
  // refusal stays the server's and this only warns.
  const filed = graph.questions.filter(
    (question) => question.section === section.id,
  ).length;

  return (
    <li className="sectionedit">
      <div className="field field--inline">
        <label htmlFor={nameId}>Name</label>
        <input
          id={nameId}
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
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
      <div className="field field--inline">
        <label htmlFor={orderId}>Order</label>
        <input
          id={orderId}
          type="number"
          value={displayOrder}
          disabled={pending}
          onChange={(event) => setDisplayOrder(event.target.value)}
        />
      </div>
      <div className="field field--inline">
        <label htmlFor={descriptionId}>Description</label>
        <input
          id={descriptionId}
          value={description}
          disabled={pending}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="sectionedit__controls">
        <button
          className="button button--primary"
          type="button"
          disabled={pending || !dirty}
          onClick={() =>
            updateSection.mutate(
              { sectionId: section.id, changes },
              { onError: onWriteError },
            )
          }
        >
          Save
        </button>
        <button
          className="button button--danger"
          type="button"
          disabled={pending}
          onClick={() => removeSection.mutate(section.id, { onError: onWriteError })}
        >
          Delete
        </button>
      </div>

      {filed > 0 && (
        <p className="panel__hint">
          {filed} question{filed === 1 ? "" : "s"} filed here. Deleting is refused until
          they are moved.
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

export function SectionEditor({ graph }: { graph: Graph }) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const addSection = useAddSection(versionId);

  const codeId = useId();
  const nameId = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const sections = [...graph.sections].sort(
    (left, right) => left.display_order - right.display_order,
  );
  const error = writeErrorMessage(addSection.error);

  return (
    <details
      className="sidebar__editor"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="diagnostics__label">Edit sections</span>
      </summary>

      <ul className="sectionedits">
        {sections.map((section) => (
          <SectionRow key={section.id} graph={graph} section={section} />
        ))}
        {sections.length === 0 && (
          <li className="empty">This version has no sections.</li>
        )}
      </ul>

      <form
        className="editor"
        onSubmit={(event) => {
          event.preventDefault();
          addSection.mutate(
            { code, name },
            {
              onError: onWriteError,
              onSuccess: () => {
                setCode("");
                setName("");
              },
            },
          );
        }}
      >
        <h4 className="panel__subheading">Add a section</h4>
        <div className="field field--inline">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            value={name}
            required
            disabled={addSection.isPending}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field field--inline">
          <label htmlFor={codeId}>Code</label>
          <input
            id={codeId}
            value={code}
            required
            disabled={addSection.isPending}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <button
          className="button button--primary"
          type="submit"
          disabled={addSection.isPending || code.trim() === "" || name.trim() === ""}
        >
          {addSection.isPending ? "Adding…" : "Add section"}
        </button>
      </form>

      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
