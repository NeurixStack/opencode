# Diff Viewer

## Goal

Add a full-screen TUI diff viewer opened by `/diff` and by a keybinding. The first version should be intentionally small: open the surface, fetch a raw VCS patch, parse it with `@pierre/diffs`, render a basic readable diff, and keep the architecture ready for tree navigation, split/unified layout, and larger patches.

## Reference Insights

The useful lesson from `hunk` is not its full architecture, but its separation between data, render rows, geometry, and navigation. It normalizes patches into file models, derives stable hunk and row cursors, caches expensive measurements, and preserves viewport position through stable anchors when layout changes.

The useful lesson from `ghui` is that a TUI diff viewer should treat scroll math as a first-class data problem. It precomputes per-file stacked offsets, uses binary search for sticky headers, keeps selected anchors visible, and avoids quadratic whitespace or wrapping work by capping expensive algorithms.

The useful lesson from `@pierre/diffs` is that we should not parse Git patches ourselves. It already provides `parsePatchFiles`, `parseDiffFromFile`, `FileDiffMetadata`, hunk metadata, line counts for unified and split views, cache keys, syntax highlighting helpers, and windowed iteration utilities like `iterateOverDiff`.

## Existing opencode Shape

The backend already has most of the raw data path:

- `Vcs.diffRaw()` returns current uncommitted changes as a raw patch from `Git.patchAll()` plus untracked files.
- `GET /vcs/diff/raw` exposes that as `text/x-diff`.
- `GET /vcs/diff?mode=git|branch` returns structured `Vcs.FileDiff[]`, but for the viewer we should start with the raw patch because it maps directly to `@pierre/diffs` parsing.
- Existing inline tool diffs use the OpenTUI `<diff>` renderable for edit and patch tool output.
- Slash commands are keymap commands with `slashName`, registered through `useBindings()` and surfaced by the command palette.
- Keybindings are declared in `src/cli/cmd/tui/config/keybind.ts`, then mapped to command names through `CommandMap`.

## Proposed Minimal Architecture

### Backend

Start with the existing endpoint:

- `sdk.client.instance.vcsDiffRaw()` or the generated equivalent for `GET /vcs/diff/raw`.
- Keep `Vcs.diffRaw()` unchanged at first.
- Later add query support for `mode=git|branch`, staged-only, pathspecs, context lines, and max bytes only when the UI needs them.

This keeps the first pass limited to uncommitted working-tree diffs and avoids introducing a new service before there is a concrete need.

### Frontend State

Add a small route-local state holder for the viewer, likely in a new `routes/diff` area or a top-level overlay component:

```ts
type DiffViewerState = {
  open: boolean
  loading: boolean
  error?: string
  raw: string
  files: DiffFileModel[]
  layout: "split" | "unified"
  selectedFile: number
  selectedHunk: number
  scrollTop: number
}

type DiffFileModel = {
  id: string
  path: string
  previousPath?: string
  patch: string
  metadata: FileDiffMetadata
  additions: number
  deletions: number
}
```

Do not add global persistence or cross-session sharing in the first version. If the viewer can be reopened in the same TUI process with fresh state, that is enough.

### Parsing

Create a tiny adapter around `@pierre/diffs`:

```ts
parsePatchFiles(raw, `vcs:${hash}`)
  .flatMap((patch) => patch.files)
  .map((metadata, index) => buildDiffFileModel(metadata, rawChunk, index))
```

The adapter should own only opencode-specific concerns:

- normalize display paths from `a/` and `b/` prefixes if the parsed metadata keeps them.
- compute additions and deletions from `metadata.hunks[*].hunkContent`.
- preserve each file patch chunk so the current OpenTUI `<diff>` renderable can render the first basic version.
- assign stable IDs from path plus index, not from array position alone.

Avoid building a custom parser, whitespace minimizer, or line-level diff engine initially.

### Rendering V1

Use the existing OpenTUI `<diff>` renderable for the first visible version. It already supports unified/split, line numbers, wrapping, colors, and syntax style.

The full-screen surface should contain:

- header: `Diff`, file count, additions/deletions, current layout, refresh hint.
- left pane: flat file list first, nested tree later.
- right pane: stacked file sections, each with a file header and `<diff>` body.
- footer: core key hints.

The nested tree is important, but the first implementation can render a flat file list with indentation-ready data. Build the tree data model in the adapter only after the flat list works.

### Navigation

Start with simple indexes:

- `j`/`down`: next hunk or next file when at the final hunk.
- `k`/`up`: previous hunk or previous file.
- `J`: next file.
- `K`: previous file.
- `tab`: toggle focus between file list and diff pane.
- `s`: toggle split/unified.
- `r`: refresh raw patch.
- `escape`/`q`: close.

The first version can scroll selected files into view. Hunk-perfect scrolling can come after a row geometry layer exists.

### Geometry Layer

Add this only after V1 rendering works.

```ts
type DiffSectionGeometry = {
  fileId: string
  top: number
  headerHeight: number
  bodyHeight: number
  bottom: number
  hunkAnchors: readonly { hunkIndex: number; top: number; height: number }[]
}
```

Use `metadata.unifiedLineCount`, `metadata.splitLineCount`, and the current `<diff>` measured height where available. Initially estimate body height from `layout === "split" ? metadata.splitLineCount : metadata.unifiedLineCount`. Refine later for wrapping and custom row rendering.

This layer enables:

- sticky file headers.
- fast file lookup by scroll offset with binary search.
- jump-to-hunk without scanning DOM/renderables.
- preserving viewport anchors when toggling layout.

### Performance Rules

- Parse raw patch once per fetched patch string.
- Do not hold both many transformed row formats and raw patches until a performance measurement justifies it.
- Cache by patch hash plus layout plus width for derived geometry.
- Prefer windowing before custom rendering large diffs.
- Do not syntax-highlight lines outside the visible window if we move away from OpenTUI `<diff>` into custom row rendering.
- Cap raw patch response size before attempting to render huge diffs; show skipped files rather than blocking the TUI.
- Keep tree building linear in path count.
- Keep navigation data as arrays and maps, not recursive lookup at keypress time.

## Future Rendering Direction

The existing `<diff>` renderable is the pragmatic starting point. If we hit limitations for tree-aware navigation, sticky headers, inline annotations, or partial rendering, move to a custom terminal row renderer backed by `@pierre/diffs` metadata and utilities:

- use `iterateOverDiff` to produce only visible rows.
- use `renderDiffWithHighlighter` or lower-level highlighting utilities for styled spans.
- maintain stable row anchors for layout toggles.
- virtualize by file section and visible row window.

Do not start here. The project should earn this complexity through measured needs.

## Roadmap

- [x] Add a `diff.open` keymap command with `slashName: "diff"` that opens a full-screen placeholder.
- [x] Add a default keybinding for `diff.open` after choosing the key sequence.
- [x] Build the full-screen shell with header, left pane placeholder, right pane placeholder, and footer hints.
- [ ] Fetch raw patch data from `GET /vcs/diff/raw` when the viewer opens.
- [ ] Show loading, empty, and error states.
- [ ] Add a small `parseDiffPatch(raw)` adapter using `@pierre/diffs.parsePatchFiles`.
- [ ] Split the raw patch into per-file chunks or derive enough patch text for `<diff>` rendering.
- [ ] Render stacked file sections with the existing OpenTUI `<diff>` renderable.
- [ ] Add split/unified layout toggle using existing `diff_style` behavior as guidance, but keep viewer-local state.
- [ ] Add basic file navigation and selected-file highlighting.
- [ ] Add basic hunk navigation based on `FileDiffMetadata.hunks`.
- [ ] Add refresh and close commands.
- [ ] Add tests for the patch parser adapter with added, deleted, modified, renamed, binary, and untracked file patches.
- [ ] Add simulation coverage that `/diff` opens the full-screen viewer and renders an empty state.
- [ ] Add simulation coverage for a generated patch rendering at least one file and hunk.
- [ ] Convert the flat file list into a nested tree model.
- [ ] Add tree expand/collapse state and keyboard navigation.
- [ ] Add section geometry estimates from `metadata.unifiedLineCount` and `metadata.splitLineCount`.
- [ ] Preserve scroll anchor when toggling split/unified.
- [ ] Add sticky file header in the diff pane.
- [ ] Add patch byte limits and skipped-file UI for huge diffs.
- [ ] Profile a large patch before introducing custom row virtualization.
- [ ] If needed, replace `<diff>` bodies with a windowed custom renderer using `@pierre/diffs.iterateOverDiff`.

## Open Decisions

- Default keybinding for opening the viewer.
- Whether `/diff` should default to uncommitted changes only or allow immediate mode selection for branch diff.
- Whether branch diff should use `Vcs.diffRaw(mode=branch)` or a separate raw patch endpoint when we add it.
- Whether staged-only diffs are required in the first useful release.
- Whether tree selection should follow scroll position immediately or only after explicit file navigation.
