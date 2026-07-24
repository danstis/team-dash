# Releasing

`team-dash` uses [release-please](https://github.com/googleapis/release-please) to
cut releases from conventional commits on `main`. A release PR is opened
automatically by `.github/workflows/release-please.yml` and merged once CI is
green; merging that PR is what publishes a release.

## Semver policy

While the project is pre-1.0.0, versions follow the `0.y.z` shape and the
release-please config in `release-please-config.json` should make the next
release match the highest-commit-type present since the last release:

| Commit type                                     | Version segment bumped | Example (from `0.1.0`) |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| `fix:`                                          | patch                  | `0.1.0` → `0.1.1`      |
| `feat:`                                         | minor (`0.y.0`)        | `0.1.0` → `0.2.0`      |
| `feat!:` / `BREAKING CHANGE:` / `chore!:`, etc. | minor (`0.y.0`)        | `0.1.0` → `0.2.0`      |

Breaking changes still bump to `0.y.0` rather than `1.0.0` while the project
is pre-1.0.0 — `bump-minor-pre-major: true` keeps everything on the
`0.y.z` line. The 1.0.0 cut is **deliberate** and should be done by hand
from a promoted MVP, not by a routine breaking-change commit.

## What not to do

- Do **not** set `bump-patch-for-minor-pre-major: true` in
  `release-please-config.json`. That flag forces pre-1.0.0 versions to bump
  only the patch segment, even when the commit set contains `feat:` entries.
  It was the root cause of `0.1.0 → 0.1.1` and `0.1.1 → 0.1.2` shipping as
  patch bumps despite many `feat:` commits (see BSOD-267).
- Do **not** edit the published entries in `CHANGELOG.md`. Release history
  is immutable; only future releases should follow the corrected rules.
- Do **not** hand-edit the version in `.release-please-manifest.json`
  unless you are intentionally re-baselining after a config bug. The
  manifest is the source of truth for the version that will be published
  next.

## Overrides

The two release-please override mechanisms still work out of the box:

- Comment `!Override X.Y.Z` on the release PR to force a specific version.
- Add the `autorelease: major` / `minor` / `patch` label to the release PR
  to force the bump type.

Neither override is required for routine releases.
