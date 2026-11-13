# What makes these videos look real

| Before (v0.1) | Now (v0.2) |
| --- | --- |
| Every frame drawn by code (dunes, car, maps) | Real camera footage, credited on screen |
| Synthetic-looking voice by default | Your voice -> Google neural Hindi voice -> Gemini -> Kokoro last |
| Game-style UI (cards, meters, HUD) | Broadcast documentary type: serif kickers, big numbers, thin credits |
| One canvas render | Real editor: clean takes chosen by scene detection, supersampled camera moves, level matching, one film LUT, grain |

## Adobe, Canva, Higgsfield
- **Adobe Premiere / After Effects / Express**: no free API the nightly run can call (Firefly Services is paid
  enterprise). Their core techniques are done in code here: clean-take selection, camera moves, colour matching,
  a film LUT, title animation, ducking and loudness. Adobe Express (free) is still the best tool for the channel
  banner and logo by hand.
- **Canva**: the design/Autofill API needs Canva Enterprise. Design the brand kit by hand on the free plan.
- **Higgsfield**: it makes AI-generated video, which works against the "real footage" promise, and its API is paid.
  It is not used in the pipeline.

## Honest by design
Real footage is the strongest protection against the "AI-made" look and against YouTube's inauthentic-content rule.
Synthetic narration is still disclosed when used. YouTube says the disclosure does not reduce reach.
