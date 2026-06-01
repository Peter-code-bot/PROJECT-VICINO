# Spec delta — android-build

## ADDED Requirements

### Requirement: Tagged release produces signed AAB
The system SHALL produce a signed Android App Bundle (`.aab`) when a maintainer pushes a git tag matching `v<major>.<minor>.<patch>(-(beta|rc).<N>)?` on `master`.

#### Scenario: stable tag triggers release build
- GIVEN the working tree on `master` is clean and `pnpm build` passes
- WHEN a maintainer pushes the tag `v0.1.0`
- THEN the release pipeline triggers automatically
- AND the pipeline produces `app-release.aab` signed with the release keystore
- AND the produced bundle has `versionName = "0.1.0"`

#### Scenario: pre-release tag is accepted
- GIVEN the working tree on `master` is clean
- WHEN a maintainer pushes the tag `v0.1.0-beta.1`
- THEN the release pipeline triggers
- AND the produced bundle has `versionName = "0.1.0-beta.1"`

### Requirement: AAB is uploaded to Play Console Internal Track
WHEN the pipeline produces a valid signed `.aab`, the system SHALL upload it to Google Play Console using the configured service account and target only the `internal` track.

#### Scenario: upload succeeds with valid service account
- GIVEN the secret `PLAY_SERVICE_ACCOUNT_JSON` is present and has `Internal Release Manager` role on Play Console
- WHEN the build of a tagged commit completes successfully
- THEN `fastlane supply --track internal` (or equivalent) is invoked
- AND the upload succeeds with HTTP 200 from the Play Developer API
- AND the `.aab` appears in Play Console Internal Track with the expected `versionCode`

#### Scenario: upload never targets production
- GIVEN any tag of any format is pushed
- WHEN the pipeline runs
- THEN the upload SHALL target only `internal`
- AND the pipeline SHALL NOT call Play Developer API with `track=production` or `track=open`

### Requirement: versionCode is strictly monotonic across releases
The system SHALL ensure that every `.aab` uploaded to Play Console has a `versionCode` strictly greater than every previously uploaded `versionCode` for this `applicationId`.

#### Scenario: sequential pre-release tags increment versionCode
- GIVEN the tag `v0.1.0-beta.1` was previously released with `versionCode = 10001`
- WHEN the tag `v0.1.0-beta.2` is pushed
- THEN the new build produces `versionCode = 10002` (or larger)
- AND Play Console accepts the upload

#### Scenario: pre-release versionCode is strictly lower than final
- GIVEN the tag `v0.1.0-rc.5` was released
- WHEN the tag `v0.1.0` (final) is pushed
- THEN the versionCode for `v0.1.0` is strictly greater than the versionCode for `v0.1.0-rc.5`

### Requirement: Pipeline is gated by Secret Handoff
WHILE the keystore secrets and `PLAY_SERVICE_ACCOUNT_JSON` are not configured in the CI dashboard, the system SHALL refuse to produce a release `.aab`.

#### Scenario: missing keystore secret aborts the build
- GIVEN `ANDROID_KEYSTORE_BASE64` is empty or undefined in the CI environment
- WHEN the pipeline runs for a tagged commit
- THEN the build step fails before invoking `gradlew bundleRelease`
- AND the error message identifies the missing secret by name
- AND no upload to Play Console is attempted

### Requirement: Pipeline preserves Vercel web auto-deploy independence
WHEN a maintainer pushes a tag, the system SHALL NOT trigger any Vercel deploy.
WHEN a maintainer pushes a commit to `master`, the system SHALL NOT trigger the Android release pipeline.

#### Scenario: tag push is invisible to Vercel
- GIVEN the repository is connected to Vercel for web auto-deploy on push to `master`
- WHEN a maintainer pushes only the tag `v0.1.0` (without any new commit on `master`)
- THEN Vercel does NOT start a new web deploy
- AND the Android pipeline starts as expected

### Requirement: Pre-release tags route to Internal Track only
WHERE the version tag includes a pre-release suffix (`-beta.<N>` or `-rc.<N>`), the system SHALL route the resulting `.aab` to Internal Track only and SHALL NOT promote it further.

#### Scenario: beta tag stays on internal track
- GIVEN the tag `v0.1.0-beta.2` is pushed
- WHEN the pipeline completes successfully
- THEN the `.aab` is visible in Play Console Internal Track
- AND the `.aab` is NOT promoted to Closed, Open, or Production tracks by the pipeline

### Requirement: Bundletool validation gates the upload
IF `bundletool validate` against the produced `.aab` reports any error, THEN the system SHALL abort the upload step and surface the bundletool report as a pipeline log artifact.

#### Scenario: bundletool failure blocks upload
- GIVEN the pipeline produces an `.aab` that fails `bundletool validate` (e.g., due to a manifest merge conflict)
- WHEN the validation step runs
- THEN the pipeline exits with a non-zero status before `fastlane supply` (or equivalent) is invoked
- AND the bundletool report is attached as a downloadable build artifact
- AND no upload to Play Console occurs

### Requirement: Secrets never persist in the repository
IF a build artifact, log file, or CI output contains the decoded keystore (`*.jks`), keystore passwords, or the Play Service Account JSON in plaintext, THEN the pipeline SHALL treat this as a critical failure, mark the run as failed, and rotate the relevant secret before any further release.

#### Scenario: keystore file is wiped at the end of the build
- GIVEN the pipeline decoded `ANDROID_KEYSTORE_BASE64` to a `release.jks` file during the build
- WHEN the build completes (whether success or failure)
- THEN the `release.jks` file is removed from the workspace
- AND no copy of the `.jks` is uploaded as an artifact or attached to a GitHub Release

#### Scenario: service account JSON is never logged
- GIVEN the pipeline reads `PLAY_SERVICE_ACCOUNT_JSON` from secrets
- WHEN the pipeline runs in any state (success, failure, retry)
- THEN no log line contains the literal contents of the JSON
- AND no log line contains the substring `"private_key"`

### Requirement: GitHub Release accompanies successful upload
WHEN the upload to Play Console Internal Track succeeds, the system SHALL publish a GitHub Release attached to the tag, with the `.aab` attached as an asset and an auto-generated changelog body containing commits since the previous tag.

#### Scenario: release is created after upload
- GIVEN a tag `v0.1.0-beta.2` was pushed, the build succeeded, and `fastlane supply` returned success
- WHEN the upload step completes
- THEN a GitHub Release exists for `v0.1.0-beta.2`
- AND the release has the `.aab` attached as a downloadable asset
- AND the release body lists commits between `v0.1.0-beta.1` and `v0.1.0-beta.2`
