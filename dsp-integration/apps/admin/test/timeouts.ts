/* Per-test timeouts, scaled on CI. A GitHub runner has two cores and renders
   these jsdom + Ant Design pages two to three times slower than a laptop, so
   limits sized locally timed out there (e2e-quick, 1 Oct 2026). Locally they
   stay tight, so a test that has really become slow still shows up. */
export const CI_FACTOR = process.env.CI ? 3 : 1
export const slow = (ms: number) => ms * CI_FACTOR
