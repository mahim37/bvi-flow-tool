import { describe, expect, it } from "vitest";

import { badgeVariants } from "./badge";
import { buttonVariants } from "./button";
import { cn } from "@/lib/utils";

describe("buttonVariants", () => {
  it("keeps a rectangular radius on every variant", () => {
    expect(buttonVariants({ variant: "primary" })).toContain("rounded-md");
    expect(buttonVariants({ variant: "primary" })).toContain("bg-primary");
    expect(buttonVariants({ size: "icon" })).toContain("size-9");
    expect(buttonVariants({ variant: "primary" })).not.toContain("rounded-full");
  });

  it("does not keep size padding on a link, so destination prompts sit flush", () => {
    const classes = cn(buttonVariants({ variant: "link" }));
    expect(classes).toContain("px-0");
    expect(classes).not.toMatch(/(?:^|\s)px-3\.5(?:\s|$)/);
  });
});

describe("badgeVariants", () => {
  it("uses the pill silhouette, not the button one", () => {
    const classes = badgeVariants({ variant: "entry" });
    expect(classes).toContain("rounded-full");
    expect(classes).not.toContain("rounded-md");
  });
});

describe("cn", () => {
  it("drops falsy values and keeps the last conflicting class", () => {
    const skip = false;
    expect(cn("rounded-md", skip && "hidden", "extra")).toContain("rounded-md");
    expect(cn("rounded-md", skip && "hidden", "extra")).toContain("extra");
  });
});
