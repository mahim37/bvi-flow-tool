import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useEligibleSubstituteReviewers, useSubmitDraft } from "../api/queries";
import type { SubstituteReviewer } from "../api/types";
import { renderWithProviders } from "../test/render";
import { REQUIRED_REVIEWER_EMAILS } from "./labels";
import { SubmitForReview } from "./SubmitForReview";

vi.mock("../api/queries", () => ({
  useEligibleSubstituteReviewers: vi.fn(),
  useSubmitDraft: vi.fn(),
}));

const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const SUBSTITUTE: SubstituteReviewer = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "outsider@example.com",
};

function submitDraft() {
  const mutate = vi.fn();
  const mutation = {
    mutate,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useSubmitDraft>;
  return { mutate, mutation };
}

function mockEligible(data: SubstituteReviewer[] | undefined, isLoading = false) {
  vi.mocked(useEligibleSubstituteReviewers).mockReturnValue({
    data,
    isLoading,
    error: null,
  } as unknown as ReturnType<typeof useEligibleSubstituteReviewers>);
}

describe("SubmitForReview", () => {
  it("is a plain confirm for an author who isn't a required reviewer", async () => {
    const user = userEvent.setup();
    const { mutate, mutation } = submitDraft();
    mockEligible([]);

    renderWithProviders(
      <SubmitForReview
        versionId={VERSION_ID}
        authorEmail="postman-demo@example.com"
        disabled={false}
        submitDraft={mutation}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText(new RegExp(REQUIRED_REVIEWER_EMAILS[0])),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Submit for review" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toBeUndefined();
  });

  it("asks a required reviewer who authored their own draft to name a stand-in", async () => {
    const user = userEvent.setup();
    const { mutate, mutation } = submitDraft();
    mockEligible([SUBSTITUTE]);

    renderWithProviders(
      <SubmitForReview
        versionId={VERSION_ID}
        authorEmail={REQUIRED_REVIEWER_EMAILS[0]}
        disabled={false}
        submitDraft={mutation}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    const dialog = screen.getByRole("dialog", { name: "Submit for review" });

    expect(
      within(dialog).getByText(new RegExp(REQUIRED_REVIEWER_EMAILS[1])),
    ).toBeInTheDocument();
    const submitButton = within(dialog).getByRole("button", {
      name: "Submit for review",
    });
    expect(submitButton).toBeDisabled();

    await user.selectOptions(
      within(dialog).getByLabelText("Who reviews in your place?"),
      SUBSTITUTE.id,
    );
    await user.click(submitButton);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toBe(SUBSTITUTE.id);
  });

  it("tells a required reviewer there is nobody eligible to stand in", async () => {
    const user = userEvent.setup();
    mockEligible([]);

    renderWithProviders(
      <SubmitForReview
        versionId={VERSION_ID}
        authorEmail={REQUIRED_REVIEWER_EMAILS[1]}
        disabled={false}
        submitDraft={submitDraft().mutation}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    const dialog = screen.getByRole("dialog", { name: "Submit for review" });

    expect(
      within(dialog).getByText(/Nobody else holds the publish grant to stand in for you/),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Who reviews in your place?"),
    ).not.toBeInTheDocument();
  });
});
