import { describe, expect, it } from "vitest";

import { financeModules } from "./registry";

describe("finance module registry", () => {
  it("uses unique keys and exposes the first production modules", () => {
    const keys = financeModules.map((module) => module.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("wht");
    expect(keys).toContain("tax-invoice");
    expect(keys).toContain("related-links");
  });
});

