// Runs before every e2e file (jest setupFiles): the suites sign in many accounts at once from one address.
process.env.LOGIN_RATE_LIMIT_PER_MINUTE =
  process.env.LOGIN_RATE_LIMIT_PER_MINUTE ?? '100';
process.env.RATE_LIMIT_PER_MINUTE =
  process.env.RATE_LIMIT_PER_MINUTE ?? '100000';
