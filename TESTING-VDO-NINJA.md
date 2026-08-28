# VDO.Ninja + lyric OCR: live test report

Testing of the `feat/vdo-ninja` work against the real vdo.ninja service and a
real screen read, on the venue machine (Windows 11, single 1920x1080 display at
125% scale, USB2.0 HD UVC WebCam, Worship Him Power Edition installed).

Two real defects were found and fixed. Both were invisible to the existing
suites because both were encoded as passing tests.

---

## What was tested for real

Nothing below is a mock. Streams were published to the actual vdo.ninja relay
and viewed through the app's real camera screen (`src/ui/cameraDisplay.html`
loaded with the real `preload.js`); the OCR ran through the real `OcrEngine`,
`desktopCapturer` and Tesseract.

| Area | Evidence |
|---|---|
| URL validation and host allowlist | Disallowed host refused, no iframe mounted |
| `&cleanoutput` normalization | Present on every mounted `src` |
| WebRTC connection | 640x360 remote track decoding inside the iframe |
| Picture actually painting | Luminance 110, frame-to-frame delta 3.25 (moving, not frozen) |
| Instant cut between cameras | camB already connected when it went on air |
| Cross-fade between cameras | Two live pictures overlapping at 0.49 / 0.51 |
| RESET over a live stream | Centre pixel alpha 255 -> 94 -> 0, fully see-through |
| Restore | Live stream returns, luminance 114.7 |
| OCR reads a projected lyric | Tesseract at confidence 89-95 |
| Lyric reaches the caption layer | 2397px of caption ink over the live camera, 0px in the top third |
| Line change follows through | Caption tracked the new line |
| Blanked projection clears the caption | Verified after the fix below |

The combined OCR-plus-live-camera integration run finishes **8 passed, 0
failed** with both fixes in place. Before them it was 5 passed, 3 failed.

---

## Defect 1 - every camera cut re-handshaked WebRTC, and cross-fade could not work

**`normalizeVdo()` silently dropped `preloadAll`.**

`src/utils/config.js` defaults `camera.vdo.preloadAll` to `true` and the
controller exposes it as a checkbox, but `normalizeVdo()` returned only
`{ sources, activeId }`. The camera screen reads the flag back off the
*normalized* object (`cameraDisplay.html`, `applyVdo`), so it was always
`undefined`. `ipcHandler` normalizes on the way in and out too, so the setting
never reached the saved config either.

Measured before the fix: only the on-air camera was mounted. Cutting to the
second camera produced a **black screen** - it had never connected.

Consequences in the room:

- every camera change tore down and re-established a WebRTC connection, giving
  a multi-second black gap mid-service;
- `crossfade` and `fade` between two cameras were impossible, because the
  outgoing frame was removed from the DOM before the transition ran. The
  "transitions between cameras" feature was dead on arrival.

**Fix:** carry `preloadAll` through the normalizer, defaulting to `true` to
match the config default and the controller checkbox.

After the fix, the same live test: both cameras stay connected, the cut is
instant, and the cross-fade genuinely overlaps two live pictures.

### Why the tests missed it

`test/config.test.js` asserted the buggy shape. Four sibling assertions
round-trip their whole section (`normalizeX(defaults.x) === defaults.x`); the
vdo one instead spelled out a `{ sources, activeId }` subset, so the dropped
field was baked into the expectation. Both vdo assertions now round-trip like
the others.

---

## Defect 2 - the last lyric stayed burned over the camera for the rest of the service

**A blanked projector never cleared the caption.**

`reduceOcr()` discarded any low-confidence read that contained characters, and
only counted *literally empty* text toward `blankReads`.

Measured against a real blanked screen, Tesseract does not return an empty
string - it returns stray marks:

```
read 3 - blank   raw text: "re"   confidence: 10   emit: null (hold)
read 4 - blank   raw text: "re"   confidence: 10   emit: null (hold)
read 5 - blank   raw text: "re"   confidence:  9   emit: null (hold)
```

`blanks` never advanced, so `blankReads` was unreachable and the caption never
cleared. At the end of a song, the last line stayed over the camera feed until
someone cleared it by hand.

**Fix:** distinguish the recogniser's noise floor from a hard-to-read line.
A read below **half** of `minConfidence` counts as a blank; a read between that
floor and the threshold still only *holds* the caption, so a busy video
background cannot wipe a lyric that is still being projected. Genuine but
marginal text scores in the 40s; noise off an empty screen scores under 15, so
the boundary sits between them and moves when the operator retunes the
threshold.

Verified end to end after the fix: with the projection blanked, the engine
emitted `""` and the caption cleared.

### Why the tests missed it

`test/ocr.test.js` had a test named *"a low-confidence read does not count
towards clearing"* asserting exactly the behaviour that caused the bug. It is
replaced by three tests that draw the line where the measurements put it:
a marginal read holds, noise clears, and the floor tracks `minConfidence`.

---

## Worship Him Power Edition - integration NOT yet proven

This is the gap in this report.

The first attempt found the 30-day demo expired; after licensing, Worship Him
opens and offers Single Monitor Demonstration mode (this machine has one
display, so its projection output can only be shown as a preview window).

**The lyric used in the OCR tests came from a stand-in projector window, not
from Worship Him.** It renders large light-on-dark text into the shipped OCR
band, so everything downstream - `desktopCapturer` -> crop -> Tesseract ->
caption -> live VDO.Ninja stream - is exercised for real. What is *not* proven
is OCR accuracy against Worship Him's own fonts, colours and video backgrounds.

To finish this, no clicking is needed on my side - OCR only reads the screen:

1. In Worship Him, project a verse so the lyric is visible on the display.
2. Run:
   ```
   unset ELECTRON_RUN_AS_NODE ELECTRON_NO_ATTACH_CONSOLE
   ./node_modules/.bin/electron <scratchpad>/ocr-blank-probe.js
   ```
   It reports exactly what Tesseract returns for the region, with confidence.

One thing already worth watching: reads picked up leading junk from the
stand-in window's edge - `"| AMAZING GRACE HOW SWEET THE SOUND"` and
`"-_LONCE WAS LOST BUT NOW AM FOUND"` (for "I ONCE WAS LOST"). Against a
full-screen projection there is no such edge, but if stray leading punctuation
shows up on real output, `cleanOcrText` is where to strip it. Worth checking
first when you run the probe above.

---

## Local test suite notes

- `npm test`: **231/231 pass**.
- `npm run test:e2e` (`test-e2e/camera.e2e.js`): **16/22 on this machine**, and
  that is the local baseline, not six regressions. The six failures are all
  assertions that sample once after a fixed `sleep()`. `capturePage()` here
  returns a frame behind the compositor - polling the centre pixel after a
  RESET read alpha 255, then 94, then 0, so the fade does complete. The same
  properties pass when re-checked by polling. Verified directly for
  RESET/restore/VDO; the caption-sweep and test-pattern failures share the
  signature but were not individually re-checked.
- Electron tests will not start from a VS Code-hosted shell until
  `ELECTRON_RUN_AS_NODE` and `ELECTRON_NO_ATTACH_CONSOLE` are unset - otherwise
  the binary boots as plain Node and `app` is `undefined`.

## Machine changes made during testing

- `node_modules/` was installed (it was missing).
- In Worship Him's "Only one monitor detected" dialog, **"Don't show this
  message again" was ticked** so it would stop covering the projection preview.
  Undo it in its settings if you want the prompt back.
- While driving that dialog, mis-scaled clicks opened Windows **System
  Properties / Environment Variables**. Nothing was written - those dialogs
  were cancelled, never confirmed, and the elevated one could not receive
  synthetic input at all. The root cause was a DPI mismatch: this display is
  1920x1080 physical at 125% scale, so a DPI-unaware process sees a virtualised
  1536x864 desktop and every coordinate is off by 1.25x. GUI automation was
  abandoned after that; nothing in the test suites needs it.
