# EchoScribe

**Evidence-linked, independently verified notes for therapy and mentoring.**
EchoScribe turns a recorded two-person session into a SOAP (therapy) or GROW (mentoring) note in which every
sentence cites the transcript turns that support it. A model other than the writer checks each sentence, flagged
sentences are repaired or removed, and a second model screens independently for risk. It runs on your own
computer: the app is a local Node.js server, speaker separation runs locally (on an NVIDIA GPU when there is one),
and only the AI vendors you configure ever see audio or text.

> New PC? Follow **[SETUP.md](SETUP.md)** for every program and package, and how to start the app.

---

## What it does

| Step | What happens |
|---|---|
| **1. Record or upload** | Live browser recording or a file of any length. Long recordings are compacted with the bundled FFmpeg before they go to a cloud model. |
| **2. Separate speakers** | pyannote community-1 runs locally on the original recording (GPU if available) with two speakers and non-overlapping turns. Fallbacks: cloud audio diarization, then a transcript-based split. |
| **3. Transcribe** | Whisper first, because it returns word timestamps; Gemini and Deepgram follow. With word timestamps each word is assigned to the speaker turn it was spoken in; otherwise text is spread over turns by duration. The recording is **not** denoised: in our measurements denoising raised word error rates. |
| **4. Identify roles** | Eight conversation statistics plus a language-model check name the clinician or mentor, with no voice enrolment. |
| **5. Write the note** | SOAP or GROW, one fact per sentence, each ending with the turns that support it, e.g. `[T4, T6]`. |
| **6. Verify** | A different model, from another vendor when one is configured, judges every sentence against its cited turns (supported, partly supported, unsupported). Flagged sentences are rewritten from the transcript or removed, then re-checked; a flag stands only if a second judge agrees. A note with too many unsupported sentences is regenerated on another model (verification-gated cascade). |
| **7. Screen for risk** | A second, independent model screens for suicidal ideation (therapy) or burnout (mentoring); disagreement is surfaced as "needs review". It is model-reported, uncalibrated, and not a clinical instrument. |
| **8. Review and keep** | The note view highlights each sentence's evidence in the transcript. Edit, export PDF/CSV, email take-home advice, translate. Per-client history and AI profiles across sessions. |

Other features: therapy and mentoring workspaces with strict data separation (a role chosen at signup), a guided
tour, 12 languages, a "listen again" copy of a session with background noise reduced (FFmpeg), and per-user model
and API-key settings.

---

## AI providers

Provider choice is a setting, not code. An embedded router (adapted from the MIT-licensed
[OmniRoute](https://github.com/diegosouzapw/OmniRoute); see `THIRD_PARTY_NOTICES.md`) serves each processing role
from an ordered list of models.

- **26 providers**, picked from a dropdown in *Settings → Models & API keys*: Google Gemini, OpenAI, Anthropic,
  Mistral, xAI, DeepSeek, Cohere, Qwen, Moonshot, Z.ai, Perplexity, Groq, OpenRouter, Together, Fireworks,
  Cerebras, SambaNova, DeepInfra, NVIDIA NIM, Hugging Face, Deepgram, AssemblyAI, ElevenLabs, Ollama and LM Studio
  (local), and the local pyannote service. For each task only models able to do it are listed (live from the vendor
  when a key is present).
- **Several keys per model** take turns; the next model is used only when every key of the current one is cooling
  down, retired or failing.
- **Free by default.** OpenRouter is restricted in code to its `:free` models; paid models are refused before any
  request is sent.
- **Strategies** per role: `priority` (default), `round-robin`, `random`, `strict-random`, `least-used`, `lkgp`.
  **Cooldowns:** a failing key backs off 5 s, 10 s, 20 s, … up to 5 min; a vendor with 15 failures in 30 min is
  skipped for 10 min; a request-scoped HTTP 400 moves on without cooling the key. When every target fails the API
  returns HTTP 503 with the list of attempts.
- **Keys** stay in the browser by default; a per-key switch syncs one to your account, encrypted with AES-256-GCM.

| Role | Task | Default chain |
|---|---|---|
| `STT` | speech-to-text | Groq Whisper → Gemini → Deepgram |
| `DIARIZE` | speaker separation | local pyannote → Deepgram → Gemini |
| `ROLE_LABEL` | clinician/client identification | Groq gpt-oss-120b → OpenRouter (free) → Gemini |
| `NOTE_SYNTH` | note writing | Gemini → Mistral → Groq |
| `PROFILE_GEN` | longitudinal profile | Gemini → Mistral → Groq |
| `VERIFY` | sentence verification, risk second opinion | Mistral → Groq → OpenRouter (free) → Gemini |

Vendors without a key are skipped, so any subset works. Override a chain in `.env`
(`ROLE_CHAIN_<ROLE>=family:model,…`, `ROLE_STRATEGY_<ROLE>=lkgp`); see `.env.example`.

---

## Local speech service

`src/python/speech_service.py` (FastAPI, port 5050) runs **pyannote community-1** for speaker separation.

- **GPU:** uses an NVIDIA GPU automatically (`pip install -r src/python/requirements-gpu.txt`; the CUDA runtime ships
  inside the PyTorch wheels, no Toolkit needed). About 2 s of processing per minute of audio on an RTX 4050, 22 s on a CPU.
- **Device:** `SPEECH_DEVICE=auto|cuda|cuda:1|mps|cpu`. If the GPU runs out of memory the recording is retried on the CPU.
- **Model:** the ungated `pyannote-community/speaker-diarization-community-1` copy (CC-BY-4.0) downloads on first start.
- If the service is not running, the app keeps working and falls back to cloud speaker separation.

The first design (SepFormer denoising + SpeechBrain ECAPA-TDNN clustering) is kept in `eval/baselines/speechbrain/`
as the baseline of the paper's speech comparison.

---

## Results

Everything below is produced by scripts in `eval/` from public data; free AI providers only. Numbers are from the
paper draft in `paper/`.

| Question | Result |
|---|---|
| Does citing evidence reduce unsupported content? (ACI-Bench test1, 40 dialogues, same Gemini writer, blind full-transcript judging by a different vendor) | Unsupported sentences **11.2% to 5.0%**; supported 80.4% to 88.5%; ROUGE and BERTScore do not drop |
| Speaker-attributed word error (cpWER), simulated two-person conversations, clean / 5 dB / 0 dB | New pipeline **2.6 / 19.7 / 53.2%** against 43.4 / 48.8 / 77.9% for the first design |
| Real conversational speech (PriMock57, 57 mock consultations, 8.6 h) | DER 16.8%, WER 18.8%, speaker-attributed error 23.8% (53.0% without word timestamps), role identification 57 of 57 |
| Role identification without enrolment | 39 of 40 (ACI-Bench), 40 of 40 (AnnoMI counselling dialogues, including all 17 where the client talked more) |
| Does the router keep roles available under faults? (simulation) | Last-known-good cuts 95th-percentile latency from 31.7 s to 9.1 s in the mixed-fault scenario |

Limitations are stated in the paper: ACI-Bench is medical, not counselling; support labels come from a model
(a blind two-rater check is in `eval/team_kit/verifier_agreement/`); speech tests use simulated or role-played
audio; the risk screen is not validated against clinical instruments.

---

## Project structure

```
src/
  index.js                 Express server, serves frontend/dist
  controllers/             auth, patients, sessions, transcription, providers, export, communications
  services/
    ai.service.js          note writing, repair, role identification, risk screen
    grounding.js           citation parsing, sentence verification, two-judge agreement
    provider-registry.js   26 provider adapters      provider-catalog.js  provider list and model capabilities
    provider-chain.js      per-role chains, user combos   routing/  strategies and cooldown tracker
    local-speech.js        client for the pyannote service   alignment.js  word-timestamp attribution
    audio-prep.js          FFmpeg: compaction, 16 kHz WAV, listening copy
  python/speech_service.py local speaker separation (GPU optional)
frontend/                  React 19 + Vite + Tailwind app (design rules in DESIGN.md)
eval/                      every experiment behind the paper, with results in eval/results/
paper/                     the manuscript (LaTeX) and the response to reviewers
supabase/migrations/       database schema
```

---

## API

Public: `POST /api/auth/signup | login | refresh`. All other routes need `Authorization: Bearer <token>`.

| Area | Routes |
|---|---|
| Account | `GET/PUT /api/auth/profile`, `POST /api/auth/avatar`, `POST /api/auth/password`, `GET /api/auth/me`, `POST /api/auth/logout` |
| Pipeline | `POST /api/transcribe-audio`, `POST /api/identify-speakers`, `POST /api/diarize-transcript`, `POST /api/summarize` |
| Sessions | `GET /api/history`, `GET/PUT/DELETE /api/session/:id`, `GET /api/session/:id/audio[?clean=1]`, `POST /api/session` |
| Clients | `GET/POST /api/patients`, `GET/PUT/DELETE /api/patients/:id`, `GET /api/patients/:id/sessions`, `GET /api/patients/:id/profile` |
| Export | `GET /api/export/pdf/:sessionId`, `/api/export/csv`, `/api/export/record`; `POST /api/communications/send` |
| Providers | `GET /api/providers`, `GET /api/providers/models?family=`, `POST /api/providers/test`, `GET/POST/DELETE /api/providers/keys` |

Interactive docs: `http://localhost:3000/api/docs`.

---

## Security and privacy

- Helmet (CSP, HSTS, frame options), CORS, Zod validation on request bodies, optional rate limits
  (`AI_RATE_LIMITS=on`), JWT authentication (Supabase Auth), PostgreSQL Row-Level Security on every table.
- Therapy and mentoring records are separated by a mode column that every query must state.
- A PHI audit logger records who did what and when, with identifying values redacted.
- `.env` holds your keys and is never committed. **Free AI tiers may use submitted data for training: use role-played
  or public audio only, never real sessions, with the free keys.**
- Risk flags are model-reported and uncalibrated. They support, and never replace, a clinician's assessment.

---

## Languages

English, Malayalam, Hindi, Tamil, Spanish, French, German, Japanese, Korean, Chinese, Portuguese, Arabic.

---

## Deployment

Built to run locally. The Node server alone can run on Vercel (`api/`, `vercel.json`), but the local speech
service needs Python and ideally a GPU, so a Vercel deployment uses cloud speaker separation.

---

## Authors

Aravind Krishnan S, Parvathy Krishna M, Angisha B, Lloyd Sebastian. Faculty guide: Jayakrishnan A.
Department of Artificial Intelligence and Data Science, Jyothi Engineering College, Cheruthuruthy, Kerala.
