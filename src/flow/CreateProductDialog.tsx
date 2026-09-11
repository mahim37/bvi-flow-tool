import { useId, useState } from "react";

import type { UUID } from "../api/types";
import { useSpawnProduct } from "../api/queries";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/slug";
import { EditorDialog } from "./EditorDialog";
import { useReviewErrorHandler, writeErrorMessage } from "./useWriteError";

/**
 * Copy this version into a brand-new questionnaire. Lives in the top bar
 * next to Product preview, not on the draft bar -- spawning is a product
 * action, not a proposal one.
 */
export function CreateProductDialog({
  versionId,
  disabled,
  onCreated,
}: {
  versionId: UUID;
  disabled?: boolean;
  onCreated: (versionId: UUID) => void;
}) {
  const nameId = useId();
  const [name, setName] = useState("");
  const spawnProduct = useSpawnProduct(versionId);
  const onReviewError = useReviewErrorHandler();
  const error = writeErrorMessage(spawnProduct.error);
  const blocked = Boolean(disabled);

  return (
    <EditorDialog
      title="Create product"
      description="Copies this version into a brand-new questionnaire, live immediately."
      disabled={blocked}
      trigger={
        <Button variant="outline" disabled={blocked}>
          Create product
        </Button>
      }
    >
      {(close) => (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            spawnProduct.mutate(
              { name, code: slugify(name) },
              {
                onError: onReviewError,
                onSuccess: (created) => {
                  close();
                  setName("");
                  onCreated(created.id);
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
          <Field label="Name" htmlFor={nameId}>
            <Input
              id={nameId}
              value={name}
              required
              placeholder="The new product's name"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={spawnProduct.isPending}
              disabled={name.trim() === ""}
            >
              Create product
            </Button>
          </div>
        </form>
      )}
    </EditorDialog>
  );
}
