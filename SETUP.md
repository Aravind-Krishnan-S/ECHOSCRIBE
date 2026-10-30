# Setup

EchoScribe is a Node.js server (the app, port 3000) plus an optional Python speech service (speaker separation with
pyannote, port 5050). Without the speech service the app still works: speaker separation falls back to a cloud model.

## 1. Prerequisites

| Program | Version | Notes |
|---|---|---|
| Node.js | 20 or newer (24 tested) | includes `npm` |
| Python | 3.10 – 3.12 | only for the speech service; 3.13 is untested |
| NVIDIA driver | 570 or newer | optional, makes speaker separation about 10× faster; no CUDA Toolkit needed |
| A Supabase project | free tier | database and sign-in |

FFmpeg is **not** needed separately: it is bundled with the Node packages.

## 2. Database

Create a project at [supabase.com](https://supabase.com), then run, in its SQL editor and in this order:
`supabase/create_patients_table.sql`, `supabase/add_contact_info.sql`, `supabase/setup_audio_storage.sql`, and the three
files in `supabase/migrations/`.

## 3. Configure

```bash
cp .env.example .env
```

Fill in `SUPABASE_URL` and `SUPABASE_KEY`. Every AI provider key is optional, and you can also add keys later in the
app under **Models & API keys**. Free options: Google AI Studio (Gemini), Groq, OpenRouter (only `:free` models are
ever called), Mistral and Deepgram.

## 4. Install and build

```bash
npm install
npm run build          # installs and builds the web app in frontend/
```

## 5. Speech service (optional but recommended)

```bash
python -m venv src/python/.venv
# Windows: src\python\.venv\Scripts\python   macOS/Linux: src/python/.venv/bin/python
src/python/.venv/bin/python -m pip install -r src/python/requirements.txt          # CPU
src/python/.venv/bin/python -m pip install -r src/python/requirements-gpu.txt      # NVIDIA GPU (CUDA 12.8)
npm run speech         # or: python src/python/speech_service.py
```

The first start downloads the pyannote community-1 model (about 30 MB, CC-BY-4.0, no sign-up needed).

## 6. Run

```bash
npm start              # then open http://localhost:3000
```

The server log shows `[Speech] Local diarization ready: … on cuda` (or `on cpu`).

## Re-running the paper's evaluations

```bash
python -m venv eval/.venv
eval/.venv/bin/python -m pip install jiwer rouge-score bert-score pyannote.metrics pymupdf numpy scipy
```

Each script in `eval/` starts with a usage line. The datasets (ACI-Bench, AnnoMI, PriMock57, LibriSpeech) are downloaded
into `eval/data/`, which is git-ignored. The paper compiles with [Tectonic](https://tectonic-typesetting.github.io/):
`tectonic paper/main.tex`. Numbers in the paper are generated from `eval/results/` by `eval/make_macros.py`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE: port 3000` | Another copy is running; stop it or set `PORT` in `.env`. |
| "The web app is not built yet" | Run `npm run build`. |
| Speech service says CUDA is not available | Install the GPU requirements and a current NVIDIA driver, or use the CPU requirements. |
| "All configured providers … failed" | A free daily quota is used up (for example Groq, about 200k tokens/day); the router moves to the next provider, or try again later. |
| Out of memory | Close other heavy programs; 8 GB RAM minimum, 16 GB recommended for the speech service. |

## Privacy

Use **role-played or public** audio only with free-tier keys: those vendors may use submitted data for training. Do not
record real therapy or mentoring sessions unless your institution has approved the vendors you configure.
