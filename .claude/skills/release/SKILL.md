---
name: release
description: Publish a new EverPad version to GitHub Releases (the Windows installer and portable exe), then prepare the Microsoft Store update for the user to submit. Use when the user asks to release / publish a version, e.g. "0.22.0 をリリースして" or "/release 0.22.0". Drafts release notes, waits for the user's approval, then uploads and publishes.
---

# Publishing an EverPad release

Publishes `vX.Y.Z` on https://github.com/nihongi/everpad/releases with exactly two files built on this PC:
`dist/EverPad Setup X.Y.Z.exe` (installer) and `dist/EverPad X.Y.Z.exe` (portable).
GitHub turns the spaces in the names into dots (`EverPad.Setup.X.Y.Z.exe`, `EverPad.X.Y.Z.exe`).

The repository has **immutable releases** enabled: once a release is published, its files and tag can never be changed.
So everything is checked while the release is still a draft, and a mistake after publishing is fixed by releasing a new version.

## Rules

- **Never publish without the user's explicit approval of the release notes in this conversation.** Approval of an earlier version does not carry over.
- Upload only the two exe files above. Never upload anything else (no zips, no CI artifacts, no files from other folders).
- Never change the files of a published release, never delete or re-upload one, and never move or delete tags (they are protected by a ruleset anyway). The notes of a published release may be edited only after the user approves the new text in this conversation.
- The Microsoft Store update is submitted by the user in Partner Center. Never sign in to Partner Center or submit anything there; only prepare the package information and the text (step 5).
- If any check fails, stop and tell the user what failed. Do not work around it.
- Do not paste or ask for tokens in the chat. `gh` is signed in with a fine-grained token limited to `nihongi/everpad` (Contents: read and write).
- `gh` may not be on PATH in an older shell: use `"/c/Program Files/GitHub CLI/gh.exe"` in Bash.

## Steps

### 1. Check that the version is ready

Run in `everpad/` (Bash):

- `node -p "require('./package.json').version"` is `X.Y.Z`.
- `git status --short` is empty, and `git rev-parse HEAD` equals `git rev-parse vX.Y.Z^{commit}`.
- The tag is on GitHub: `git ls-remote --tags origin vX.Y.Z`.
- The GitHub Actions build for the tag succeeded. Read it without signing in:
  `curl -s "https://api.github.com/repos/nihongi/everpad/actions/runs?event=push&branch=vX.Y.Z"` → the latest run has `"conclusion": "success"`.
  If it is still running, tell the user and wait; if it failed, stop.
- No release exists for the tag yet: `gh release view vX.Y.Z` must fail with "release not found".

### 2. Check (or make) the local build

- Both exe files exist in `dist/` and are newer than the tag's commit (`git log -1 --format=%cI vX.Y.Z`).
- If either is missing or older, build from the clean tagged commit: `npm run dist -- --publish never` (takes a few minutes), then check again.
- Smoke test the portable exe in a scratch folder (copy it there, start it, confirm it is still running after ~10 seconds and that `EverPad Data` was created next to it, then close it). Never use the user's real `Documents\EverPad` folder.
- Compute the SHA-256 of both files: `sha256sum "dist/EverPad Setup X.Y.Z.exe" "dist/EverPad X.Y.Z.exe"`.

### 3. Draft the release notes and ask for approval

Collect the changes since the previous release tag:
`git log --format='%h %s%n%b' vPREV..vX.Y.Z` (the commit bodies list the changes in detail) and, if useful, the README diff.

Write the notes to the scratchpad (`release-notes-X.Y.Z.md`) in this shape — English first, then the same content in Japanese:

```markdown
## What's new
- **Feature name** — What the user can now do, and where to find it (menu path / button). One or two sentences.

## Changes and fixes
- ... (omit the section if there are none)

## Compatibility
- Anything about data written by this version and older versions, settings, or behaviour that changed. Omit if nothing.

## Downloads (Windows)
| File | Type | SHA-256 |
|---|---|---|
| EverPad.Setup.X.Y.Z.exe | Installer | `<full hash>` |
| EverPad.X.Y.Z.exe | Portable (no installation; data is saved in "EverPad Data" next to the exe) | `<full hash>` |

The files are not code-signed, so Windows SmartScreen may show a warning: choose "More info" → "Run anyway".
EverPad is also available on the [Microsoft Store](https://apps.microsoft.com/detail/9mw2hbgkgxh3), which updates it automatically (a new version may reach the Store a few days later).
macOS and Linux builds are not published yet (they can be built from the source; see the README).

---

## 新しい機能
- **機能の名前** — できるようになったことと、その場所(メニュー・ボタン)。1〜2文。

## 変更と修正
## 互換性
## ダウンロード(Windows)
| ファイル | 種類 | SHA-256 |
|---|---|---|
| EverPad.Setup.X.Y.Z.exe | インストーラー | `<ハッシュ>` |
| EverPad.X.Y.Z.exe | portable 版(インストール不要。exe と同じフォルダの「EverPad Data」に保存) | `<ハッシュ>` |

コード署名をしていないため、Windows の SmartScreen が警告を出すことがあります。「詳細情報」→「実行」を選んでください。
[Microsoft Store](https://apps.microsoft.com/detail/9mw2hbgkgxh3) でも配布しています。Microsoft Store が自動で更新します(新しい版が Store に届くのは、数日あとになることがあります)。
macOS 版と Linux 版は、まだ配布していません(ソースから作れます。README を見てください)。
```

Writing style: plain words for end users, no internal names (functions, file formats) unless they matter to users; keep it short.
Show the full notes in the chat (title: `EverPad X.Y.Z`) and ask the user to approve or request changes. Wait.

### 4. After approval: draft, verify, publish

1. Create a draft (fails if the tag is not on GitHub, so no new tag is ever created):
   ```bash
   gh release create vX.Y.Z --draft --verify-tag --title "EverPad X.Y.Z" --notes-file "<scratchpad>/release-notes-X.Y.Z.md" "dist/EverPad Setup X.Y.Z.exe" "dist/EverPad X.Y.Z.exe"
   ```
2. Check the draft (drafts are not returned by `releases/tags/...`, so use the list):
   ```bash
   gh api repos/nihongi/everpad/releases --jq '.[] | select(.tag_name=="vX.Y.Z") | {draft, name, assets: [.assets[] | {name, size, digest}]}'
   ```
   Exactly two assets, names as above, and each `digest` equals `sha256:<local hash>`. If not, stop (the draft can be deleted with the user's OK and recreated).
3. Publish: `gh release edit vX.Y.Z --draft=false --latest`
4. Confirm: `gh api repos/nihongi/everpad/releases/tags/vX.Y.Z --jq '{immutable, draft, html_url}'` → `immutable: true`, `draft: false`.
   Also check `https://api.github.com/repos/nihongi/everpad/releases/latest` now returns `vX.Y.Z` (this is what the app's update check reads).
5. Report the release URL and the two hashes to the user.

### 5. Prepare the Microsoft Store update (the user submits it)

The Store package is not built on this PC and is not uploaded to the release. It comes from the GitHub Actions build of the tag.

1. Check the Store package in that build (the run found in step 1). The Windows job's annotations must include
   `Installed: NobuyoshiNIHONGI.EverPad_X.Y.Z.0_x64__yqg2q417k4v4a` and `WACK: PASS`
   (the "Blocked executables" FAIL listed with it is normal for Electron apps and does not affect the result):
   ```bash
   job=$(gh run view <run id> --json jobs -q '.jobs[] | select(.name | test("windows")) | .databaseId')
   gh api repos/nihongi/everpad/check-runs/$job/annotations -q '.[] | "\(.annotation_level): \(.title // "") \(.message[0:160])"'
   ```
   If either is missing, stop and tell the user.
2. Draft the Store's "What's new in this version" text (`この版の新機能`, up to 1,500 characters each) in Japanese and English, from the approved release notes.
   Leave out anything that does not apply to the Store version (the update check, the "Send to" menu, the installer, the portable version, SmartScreen).
   Write it to the scratchpad (`store-whats-new-X.Y.Z.md`) and show it in the chat. The other listing text is in `store/listing.md`; update that file too if a feature in the listing changed.
3. Tell the user how to submit (in Japanese):
   - Download `everpad-windows` from Artifacts at the bottom of the run's page (`https://github.com/nihongi/everpad/actions/runs/<run id>`). It is a zip: extract it and use `EverPad-X.Y.Z-store.appx` inside. Artifacts are kept for 30 days.
   - In Partner Center: Apps and games → EverPad → start an update submission.
   - Packages: drag in the `.appx`, wait until it is validated and shows `vX.Y.Z.0`, remove the old package, and Save. If the page stays on "Loading...", reload it (the submission draft is kept) or open it in an InPrivate window.
   - Store listings: paste the "What's new" text for ja-JP and en-US.
   - If an error says Windows Mixed Reality hardware must be chosen, uncheck "PC" (and "HoloLens") under immersive view: EverPad is a 2D app.
   - Submit. Certification usually takes a few hours to a day, sometimes a few days. After it passes, installed copies update automatically (Microsoft Store → Library → Get updates to update at once), and Help → About shows X.Y.Z.
