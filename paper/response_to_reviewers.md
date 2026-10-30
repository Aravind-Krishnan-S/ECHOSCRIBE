# Response to the Review Panel

**Paper:** EchoScribe: Evidence-Linked, Independently Verified Notes for Therapy and Mentoring
(submitted as "EchoScribe: An AI-Powered Clinical Documentation Platform with Multi-Provider Speech Processing, Speaker Diarization, and Intelligent SOAP/GROW Note Generation")

We thank the panel for its careful review. The comments led us to rework the paper substantially. The revision states a specific, testable contribution, notes in which every sentence cites the transcript turns that support it and is checked by an independent model, and evaluates it on public data with standard metrics instead of pilot statistics. The related work and references were rebuilt, the paper was reformatted in the IEEE conference template within six pages, and all figures and tables are now cited and discussed in the text. Our responses to each comment follow; section, table and figure numbers refer to the revised manuscript.

---

**Comment:** *Revise the paper by including the novelty for the paper.*

**Response:** The submitted version presented a configurable multi-provider chain, which is engineering rather than a research contribution. The revision is built around three contributions, listed at the end of Section I: (1) evidence-linked notes, where each sentence of a SOAP or GROW note cites the transcript turns it rests on (Section III-C); (2) independent verification, in which a model other than the writer, from another vendor where available, labels each sentence as supported, partly supported or unsupported, with a verification-gated cascade that regenerates a note on another model when too many sentences are unsupported, and a second-opinion risk screen (Sections III-C and III-D); and (3) an embedded router with per-key cooldowns, a provider breaker and routing strategies that keeps every processing role available under quota exhaustion, outages and revoked keys (Section III-A). Each contribution is evaluated in Section IV. The title was changed to reflect this contribution.

**Comment:** *Improve Performance Evaluation.*

**Response:** The submitted evaluation reported session counts and model self-assessed confidence from a small pilot deployment and, as the paper itself acknowledged, contained no accuracy measurements. We removed the pilot results entirely. Real session recordings had been processed by third-party model APIs, and we do not think such data should be reported without participant consent and ethics approval. The new Section IV uses public data and released scripts that produce every number in the paper:

- Router under injected faults: five policies, three fault scenarios, five seeds; success rate, wasted calls and 95th-percentile latency (Section IV-B, Table I).
- Note quality and grounding on the 40 test dialogues of ACI-Bench: ROUGE, BERTScore, citation coverage and the share of sentences judged supported by an independent model (Section IV-C, Table II).
- Verifier accuracy on deliberately planted errors (changed numbers, flipped negations, borrowed sentences) and false alarms on unchanged sentences (Section IV-C, Table II).
- Clinician/client identification without enrolment, on ACI-Bench, 40 AnnoMI counselling dialogues and 57 PriMock57 consultations (Section IV-D).
- Held-out re-check of sentence support: the same ACI-Bench dialogues were written with and without one-fact-per-sentence writing and sentence repair, and every sentence was judged again by a model from a different vendor than the writer. Supported sentences rose from 79.1% to 88.5% and unsupported ones fell from 7.2% to 3.2% (paired per-note gain 9.45 points, 95% CI 6.2 to 12.8). The same held-out judge rated 65.4% of AnnoMI sentences supported; our first, Gemini-judged figure of 80.3% was inflated and is replaced (Section IV-C).
- GROW notes on mentoring sessions (Section IV-F): 19 scripted sessions rendered as synthetic speech and 4 role-played sessions recorded by the authors (32 min), all processed end to end with two speakers found, roles assigned and GROW notes complete in every session; the held-out judge rated 82.7% and 88.5% of sentences supported. These show feasibility, not accuracy; no human rated GROW content.
- Speech recognition (WER), diarization (DER) and speaker-attributed WER (cpWER) on simulated two-person conversations built from LibriSpeech, clean and at 5 dB and 0 dB SNR (Section IV-E, Table III).

The speech evaluation also changed the system. Denoising with SepFormer before transcription raised word error rates under noise (Whisper at 0 dB: 36.0% without, 70.9% with denoising), and the earlier ECAPA-TDNN clustering had 23.1% DER on clean audio. The pipeline now runs pyannote community-1 diarization on the original recording (9.3% DER) and assigns each recognised word to a speaker by its Whisper timestamp; speaker-attributed error (cpWER) on clean audio fell from 43.4% for the submitted design to 2.6%, and at 5 dB to 19.7%, against 37.1% for cloud audio diarization. Noise reduction is kept only for replaying a session. The old pipeline is reported as a baseline in Table III, including the one condition (0 dB) where it still attributes words slightly better.

Section V states what remains unvalidated (no public therapy or mentoring corpus with reference notes, model-judged support labels, read rather than spontaneous speech, an unvalidated risk screen) and describes the blinded human-rating kits released with the code; they have not yet been used by raters.

**Comment:** *Related work part is poor.*

**Response:** Section II was rewritten as four subsections: (A) ambient scribes and clinical note generation; (B) hallucination, grounding and verification; (C) speaker diarization, enhancement and recognition; (D) routing across language models. Each subsection ends by stating what existing work does not do and how EchoScribe differs.

**Comment:** *A few formatting mistakes.*

**Response:** The paper was rebuilt in the IEEEtran conference template and reduced from nine pages to six. Tables were redesigned to fit the column width, captions follow IEEE style, and the references use the IEEEtran bibliography style.

---

**10. Limited Literature Review:** *The literature review is brief and covers only a limited number of existing studies. The authors should incorporate more recent and relevant research on automated clinical note generation, speaker diarization, speech enhancement, and LLM-based documentation systems.*

**Response:** The bibliography grew from 15 to 46 references, most from 2023–2025, covering all four requested areas: clinical note generation (ACI-Bench, the MEDIQA-Chat tasks, clinical summarisation and ambient-scribe studies), speaker diarization (ECAPA-TDNN, powerset segmentation, Sortformer, DiarizationLM, WhisperX, speaker-role identification), speech enhancement and its effect on recognition, and LLM documentation and hallucination (FActScore, SelfCheckGPT, Chain-of-Verification, citation-constrained generation). While revising, we checked every reference against its source. Some citations in the submitted version could not be verified or had incorrect details; they were replaced with verified sources.

**11. Inadequate Citation and Explanation of Tables and Figures:** *The tables and figures should be properly referenced and explained in the main text. Each table and figure should have a meaningful caption, and its relevance to the proposed methodology or experimental results should be clearly discussed.*

**Response:** Every figure and table is now cited in the text, has a caption that explains what it shows, and is followed by a paragraph interpreting it: Fig. 1 (pipeline, Section III), Fig. 2 (verification bar, labelled and cited sentences and transcript in the session view, Section III-C), Table I (router, Section IV-B), Table II (notes and verification, Section IV-C) and Table III (speech, Section IV-E). Tables that only listed configuration settings or technology stacks were removed.

**12. Poor Figure Clarity:** *The quality and readability of the figures need improvement. The authors should provide higher-resolution diagrams with clearly visible labels, appropriate font sizes, and better organization of components and connections.*

**Response:** Fig. 1 was redrawn as a vector diagram (TikZ), so it stays sharp at any zoom. Labels are set in the document's font at a readable size, each processing role is a labelled box, and fallback paths are shown as dashed arrows. Fig. 2 uses captures of the current interface (a) verification bar and Objective section with sentence labels and cited turns, (b) the cited transcript turns, rendered from real pipeline output on an invented example session.

---

**Other changes.** An AI-use disclosure was added to the Acknowledgments, as IEEE policy requires. The repository linked in the paper contains the evaluation scripts and result files used for every reported number.

We are grateful for the panel's comments, which improved both the paper and the system.

*The authors*
