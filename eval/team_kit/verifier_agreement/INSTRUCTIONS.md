# Verifier agreement: rating instructions

**Goal.** Check whether the independent AI verifier judges note sentences the way people do.
Two raters label the same 60 sentences **independently**; we then measure how often the raters agree
with each other and with the verifier (Cohen's κ). About 2 hours per rater.

**Files.**
- `items.csv`: one row per sentence: the note sentence and the transcript turns it cites.
  Open it in Excel or Google Sheets and **save your copy as `rater_A.csv` or `rater_B.csv`** (CSV format).
- `key.csv`: the verifier's labels. **Do not open it** until both raters have finished.

**For each row**, read the sentence and *only* its cited turns (not the rest of the visit), then
write one label in `rater_label`:

| Label | Use it when |
|---|---|
| `supported` | every claim in the sentence is stated or directly implied by the cited turns |
| `partial` | some of the sentence is supported, but it adds a detail, number, name or judgement the cited turns do not contain |
| `unsupported` | the cited turns do not support it, or no turns are cited and it states a fact about the session |

Clinical interpretation clearly framed as the clinician's impression (for example "presentation is
consistent with …") counts as `supported` when the cited turns contain the observations it rests on.

These are the exact definitions the verifier was given. Use `rater_note` for a short reason if you
are unsure (optional). Do not discuss items with the other rater until both files are done.

**When both are done**, put `rater_A.csv` and `rater_B.csv` in this folder and run:

    eval/.venv/Scripts/python -I eval/verifier_agreement.py

Results go to `eval/results/verifier_agreement.json`.

*Source: ACI-Bench test1 (CC BY 4.0), notes written by Gemini or gpt-oss-120b and verified by a model
other than the writer. Sample: 20 sentences per verifier label, seed 0 (`node eval/make_rater_kit.js`).*
