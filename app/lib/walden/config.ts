// Walden-specific portal rules. Values here mirror Walden's requirements doc
// ("Walden Local Meat: Recharge demo portal requirements", Nov 18 2026) and are
// the single place to tweak them for the demo.

export const WALDEN = {
  /** Build Your Own order minimum (R-08). Orders under this won't ship. */
  orderMinimum: 149.99,

  // Charge → delivery offset and the edit lock window come from /merchant
  // (data/merchant-settings.json), per bundle variant. See walden/dates.ts.

  /** Label shown above the plan card when we can't infer one from the bundle. */
  defaultPlanTitle: "Build Your Own",

  skipReasons: [
    "I'll be away / traveling",
    "I still have plenty in my freezer",
    "None of the delivery days work for me",
    "Budget — skipping this month",
    "Other",
  ],
} as const;
