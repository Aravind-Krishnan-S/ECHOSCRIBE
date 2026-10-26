# EchoScribe evaluation — team kit (human parts)

The automated experiments (router simulation, ACI-Bench notes, planted-error detection, role
identification, LibriSpeech WER/DER) are scripted in `eval/`. Three measurements need people.
Each takes about two to four hours of team time. Results go in `eval/results/human/`.

## 1. Blinded note-quality rating (E7)

**Raters:** 2–3 people with clinical or counselling background (faculty, psychology postgraduates).
For mentoring notes, 2 faculty mentors. Raters must not be authors of the system.

**Material:** 20 role-played sessions (12 therapy, 8 mentoring), 5–10 minutes each, recorded with
written consent from the two role-players (see `roleplay_protocol.md`). For each session, produce
two notes: EchoScribe's evidence-linked note, and a single-pass note without citations or
verification (run with `NOTE_GROUNDING=off`). Shuffle and strip provider names; label notes A/B
with a random key kept by a non-rater.

**Form:** `rating_form.csv`, one row per note. Each criterion is rated 1–5:

| Criterion | 1 | 5 |
|---|---|---|
| Accuracy | Several statements contradict the session | Every statement matches the session |
| Completeness | Key content missing | Everything a professional would record is present |
| Unsupported content | Many statements not in the session | None |
| Attribution | Professional and client statements confused | Always attributed correctly |
| Usefulness | Would rewrite from scratch | Would sign with minor edits |

Raters also count unsupported sentences per note. Report the mean and SD per criterion and
condition, a paired Wilcoxon test between conditions, and inter-rater agreement (Krippendorff's
alpha, ordinal).

## 2. Role-play annotation for real-speech WER/DER (E8)

Using the same 20 recordings: two annotators mark speaker turns in Audacity (label track per
speaker, export as text) and transcribe each turn verbatim. Convert labels to RTTM with
`labels_to_rttm.py` (to be added when the first files exist) and score with
`eval/score_audio.py`. This gives WER, DER and role accuracy on realistic two-person sessions,
complementing the simulated LibriSpeech conversations.

## 3. Risk-screen probe (E9)

`risk_vignettes.md` contains 24 draft vignettes (short transcripts). **A licensed clinician must
review and correct every vignette and its label before use**; the drafts were written for coverage
of hard cases (idioms such as "this deadline is killing me", past ideation that has resolved,
third-party concern) and are not validated material.

Run each vignette through EchoScribe; record the primary flag, the second-opinion flag and
agreement. Report sensitivity and specificity with Wilson 95% intervals, separately for the primary
model, the second opinion, and the either-flags rule. Present it as a safety probe of a small set,
never as validation of a screening instrument.

## Ethics

All recordings are role-plays by consenting adults. No real patient or student data. Store audio
only on project machines; delete it after the paper's camera-ready deadline unless consent covers
retention.
