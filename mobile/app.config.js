// Wraps app.json to stamp the JS bundle with the git SHA it was built from.
// EAS sets EAS_BUILD_GIT_COMMIT_HASH in the build env; local dev shows 'local'.
// Read at runtime via Constants.expoConfig.extra.gitSha (settings screen) —
// exists so "which build is actually on the phone" is never a guess again.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    gitSha: (process.env.EAS_BUILD_GIT_COMMIT_HASH ?? '').slice(0, 7) || 'local',
  },
});
