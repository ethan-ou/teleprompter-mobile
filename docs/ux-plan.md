# UX first pass

Scope agreed for the first pass. Deferred: reading-time/progress indicators, tap-individual-word-to-reposition.

## 1. Dark mode across the whole app
The list (`app/index.tsx`) and editor (`app/edit/[id].tsx`) are light (`#f5f5f5` / `#fff`); the
teleprompter is already black. Make the whole app dark and consistent.
- Centralize a small theme palette (bg, surface, text, muted, accent `#007AFF`, danger `#FF3B30`)
  instead of scattering hex literals.
- Update list, editor, menus, FAB, empty states. Set `userInterfaceStyle` and status-bar style to match.

## 2. Redesign the teleprompter control bar
Today (`app/teleprompter/[id].tsx`) it's a cramped wrapping row of icon buttons with 9px labels — hard
to hit in landscape, and align/orientation are mystery-meat cycling toggles.
- Larger, finger-friendly targets; group by function (transport / layout / text).
- Replace blind cycle-toggles with clearer affordances (segmented controls or labelled state).
- **Listening indicator**: a clear mic-active state (pulsing dot / level meter) so the user knows
  recognition is live; show a short countdown when starting.

## 3. Scroll-to-reposition (manual recovery)
While playing, the auto-scroll currently fights the user (scrolling is disabled, position only moves
forward). New behavior: **scrolling up re-anchors the matcher to the top of what's now on screen** so
reading resumes from there, instead of being dragged back down.
- Re-enable manual scroll during playback; on user scroll, map the top visible token → matcher position
  and call `recognizer.updatePosition(...)` + reset the transcript window.
- Debounce so auto-scroll vs. user-scroll don't thrash (distinguish programmatic from user gestures).

## 4. Quick wins
- **Keep-awake** — the screen can currently sleep mid-read. Add `expo-keep-awake`, active only while
  playing.
- **Haptics** — `expo-haptics` is already a dependency but unused. Add feedback on play/pause/reset and
  key toggles.
- **Distinct current word + reading line** — highlighted and current words are both `#FFD700`. Give the
  current word its own treatment and add a fixed reading-line indicator (a subtle band/marker at the
  alignment point) so the eye has an anchor.

## 5. Intro / list / editor usability
- List: make the row tap-target and primary action obvious (tap row currently opens *edit*, a small
  separate button launches the teleprompter — reconsider so the obvious tap = present/open).
- Replace the hand-rolled absolute-positioned dropdown menu with something more robust.
- Editor: allow launching the teleprompter directly from the editor; clearer save affordance.
- General polish for the dark theme so the intro screens feel intentional, not like a default template.
