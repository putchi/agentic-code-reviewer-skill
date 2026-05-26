# Review UI/UX Improvements

**Date:** 2026-05-26
**Status:** Approved

## Context

The review UI has four usability gaps:
1. Top-bar annotation toolstrip icons show no hover feedback — they only respond on click.
2. "Save" and "Done" buttons have unclear semantics; users don't know what "Done" does vs "Save".
3. There is no per-finding Dismiss action — users can't mark a finding as won't-fix or false positive.
4. Clicking "Done" silently discards the review with no warning, even when CRITICAL findings are unaddressed.

## Scope

Client-side only (React + CSS). No server behavior changes except adding `dismissedIds` and `dismissReasons` fields to the existing `DecisionPayload` type and persisting them in the saved markdown.

---

## 1. Toolstrip Icon Hover Fix

**Problem:** `.toolstrip button:hover` styles are not applying — buttons only show feedback on `:active`.

**Fix:** Audit `AnnotationToolstrip.tsx` and `globals.css` for pointer-events overrides or specificity conflicts. Ensure each toolstrip button has a visible hover background change using the existing `var(--surface)` token. No behavior change.

---

## 2. Rename "Done" → "Close" + Add Tooltips

**Changes:**
- Rename the "Done" button label to **"Close"**.
- Add `title` tooltip attributes:
  - **Implement:** `"Send selected findings to the implementation plan and close"`
  - **Save:** `"Save findings and decisions to a markdown file — review stays open"`
  - **Close:** `"Exit without saving"`
- Visual distinction: Save gets secondary/outline style; Close gets ghost/plain style (no fill). Implement retains its primary blue style.

---

## 3. Dismiss Action

### Action bar placement

A **"Dismiss"** button appears in the action bar, to the right of "Implement", styled with a red/danger variant. It is enabled only when `checkedIds.size > 0`.

### Behavior

1. User checks one or more findings, clicks **Dismiss**.
2. A small modal appears: "Dismiss [N] finding(s)?" with an optional free-text reason field ("Reason (optional)") and two buttons: **Dismiss** (confirm, red) and **Cancel**.
3. On confirm:
   - Checked finding IDs move from `checkedIds` into a new `dismissedIds` set (replacing checked state).
   - If a reason was entered, it is stored in `dismissReasons[findingId]` for each dismissed finding.
   - Checkboxes on dismissed findings are cleared.
4. In the left panel, dismissed findings render dimmed (opacity 0.45) with a `line-through` style on their severity badge text.
5. Dismissed findings can be un-dismissed by clicking them and using **Dismiss** again (toggling back to unchecked/pending state — a second Dismiss modal with a "Un-dismiss" option, or simply clicking the finding restores it to pending).

### Type changes (`DecisionPayload`)

```typescript
interface DecisionPayload {
  action: 'implement' | 'save' | 'done';
  selectedIds: string[];
  dismissedIds: string[];                    // new
  dismissReasons: Record<string, string>;    // new
  comments: Record<string, string>;
  globalComment: string;
  lineAnnotations: Record<string, LineAnnotation>;
}
```

### Markdown output

In the saved markdown, dismissed findings appear in a dedicated section:

```markdown
## Dismissed Findings

- [HIGH] `src/foo.ts:42` — Missing null check
  _Reason: handled upstream by validation middleware_
```

---

## 4. Close Guard (Discard Protection)

### Trigger conditions

The guard fires when:
- User clicks **Close** (formerly "Done"), AND
- At least one CRITICAL finding is neither in `selectedIds` nor in `dismissedIds`.

If no unaddressed CRITICAL findings exist, Close proceeds immediately without a modal.

### Guard modal content

```
┌─────────────────────────────────────────────────────┐
│  You have N unaddressed critical finding(s)         │
│                                                     │
│  • [file:line] finding description                  │
│  • [file:line] finding description                  │
│                                                     │
│  [  Save for Later  ]       [ Close Anyway ]        │
└─────────────────────────────────────────────────────┘
```

- **Save for Later** — calls the same `/api/save` endpoint, then closes.
- **Close Anyway** — proceeds with `/api/done`, no save.

### Browser tab-close (`beforeunload`)

If any CRITICAL findings are unaddressed when the user closes/refreshes the tab, the browser's native `beforeunload` dialog fires ("Changes you made may not be saved"). This is a best-effort guard — browsers limit custom messages here.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/client/src/components/ActionBar.tsx` | Add Dismiss button; rename Done→Close; add tooltips |
| `packages/client/src/components/ActionBar/DismissModal.tsx` | New: reason prompt modal |
| `packages/client/src/components/ActionBar/CloseGuardModal.tsx` | New: close guard modal |
| `packages/client/src/components/LeftPanel/FindingsList.tsx` | Dim dismissed findings |
| `packages/client/src/globals.css` | Dismiss/Close button styles; fix toolstrip hover |
| `packages/client/src/components/DiffViewer/AnnotationToolstrip.tsx` | Fix hover CSS specificity |
| `packages/client/src/App.tsx` | Add `dismissedIds`/`dismissReasons` state; `beforeunload` handler; wire modals |
| `packages/shared/src/types/` | Extend `DecisionPayload` with `dismissedIds`, `dismissReasons` |
| `packages/server/src/routes/decisions.ts` | Pass through `dismissedIds`/`dismissReasons` to markdown save |
| `packages/server/src/findings.ts` | Render dismissed findings section in markdown output |

---

## Verification

1. **Hover fix:** Open review UI → hover each toolstrip icon → background change appears without clicking.
2. **Tooltips:** Hover Implement/Save/Close → correct tooltip text appears.
3. **Dismiss flow:** Check 2 findings → click Dismiss → modal appears → enter reason → confirm → findings dim in left panel → uncheck state cleared.
4. **Un-dismiss:** Click a dismissed finding → it returns to unchecked/pending state.
5. **Saved markdown:** Click Save after dismissing → open saved `.md` → dismissed section present with reasons.
6. **Close guard (triggered):** Leave a CRITICAL finding unchecked and undismissed → click Close → guard modal appears with the finding listed → "Save for Later" saves then closes.
7. **Close guard (skipped):** All CRITICAL findings are either checked or dismissed → click Close → no modal, exits immediately.
8. **beforeunload:** With unaddressed CRITICAL findings, refresh the tab → browser shows native "leave page?" dialog.
