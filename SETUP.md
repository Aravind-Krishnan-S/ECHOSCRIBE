# EchoScribe — setup on a new Windows PC

EchoScribe runs locally: a Node.js server (the app, port 3000) and a Python speech service
(speaker separation with pyannote, port 5050). The `.env` file in this folder already holds the
API keys and database settings, so the app works as soon as everything is installed.

> `.env` contains private keys. Do not upload this folder or the zip anywhere public.

## 1. Install these programs first

| Program | Version | Where | Notes |
|---|---|---|---|
| **Node.js** | 24.x (LTS) | https://nodejs.org | Includes `npm`. Tick "Add to PATH". |
| **Python** | 3.12.x | https://www.python.org/downloads/ | Tick **"Add python.exe to PATH"** on the first screen. 3.10–3.12 work; 3.13 is not tested. |
| **Git** (optional) | any | https://git-scm.com | Only needed to clone instead of using the zip. |
| **NVIDIA driver** (optional) | 570 or newer | https://www.nvidia.com/Download/index.aspx | Only on PCs with an NVIDIA GPU; makes speaker separation about 10× faster. No CUDA Toolkit needed. |
| **Microsoft Edge or Chrome** | any recent | | To use the app. |

FFmpeg is **not** needed separately: it is bundled with the Node packages.

Check in a new terminal (PowerShell):

```powershell
node -v      # v24.x
npm -v
python --version   # Python 3.12.x
```

## 2. Install the Node.js packages (server and app)

Open PowerShell in the `ECHOSCRIBE` folder (the one containing this file):

```powershell
npm install
cd frontend
npm install
npm run build
cd ..
```

This installs, from `package.json`:

- **Server:** express, cors, helmet, express-rate-limit, multer, zod, dotenv, undici,
  @supabase/supabase-js, @google/generative-ai, groq-sdk, @deepgram/sdk, @ffmpeg-installer/ffmpeg,
  mime-types, pdfkit, json2csv, resend, swagger-jsdoc, swagger-ui-express
- **App (frontend):** react, react-dom, react-router-dom, @tanstack/react-query, motion,
  lucide-react, react-hook-form, @hookform/resolvers, zod, clsx, @fontsource-variable/archivo,
  and for building: vite, typescript, tailwindcss (@tailwindcss/vite), @vitejs/plugin-react

## 3. Install the Python speech service

Still in the `ECHOSCRIBE` folder:

```powershell
python -m venv src\python\.venv
src\python\.venv\Scripts\python -m pip install --upgrade pip
```

Then **one** of these:

```powershell
# PC with an NVIDIA GPU (about 3.5 GB download)
src\python\.venv\Scripts\python -m pip install --no-cache-dir -r src\python\requirements-gpu.txt

# PC without an NVIDIA GPU (smaller, CPU only)
src\python\.venv\Scripts\python -m pip install -r src\python\requirements.txt
```

This installs: **torch 2.8.0** and **torchaudio 2.8.0** (CUDA 12.8 build on GPU PCs),
**pyannote.audio 4.0.7**, fastapi, uvicorn, python-multipart, soundfile and numpy. The first start
downloads the pyannote community-1 model (about 30 MB) into `src\python\pretrained_models\hf`.

## 4. Start EchoScribe

Two terminals, both in the `ECHOSCRIBE` folder:

```powershell
# Terminal 1 — speech service (leave it running)
src\python\.venv\Scripts\python src\python\speech_service.py
```

```powershell
# Terminal 2 — the app
npm start
```

Open **http://localhost:3000**. The server log shows
`[Speech] Local diarization ready: … on cuda` (GPU) or `on cpu`.
If the speech service is not running, the app still works: speaker separation falls back to Gemini.

## 5. Optional: re-run the paper's evaluations

Only needed to reproduce the numbers in the paper (`paper/main.pdf`).

```powershell
python -m venv eval\.venv
eval\.venv\Scripts\python -m pip install jiwer rouge-score bert-score pyannote.metrics pymupdf numpy scipy
```

The evaluation scripts are in `eval\` (each file starts with a usage line). Speech evaluations use
`src\python\.venv`; the AlignScore metric uses its own environment (`eval\.venv-align`, see
`eval\alignscore_notes.py`). The paper compiles with Tectonic (`tectonic paper\main.tex`).

## Troubleshooting

| Problem | Fix |
|---|---|
| `node` or `python` not found | Reinstall with "Add to PATH" ticked, then open a new terminal. |
| `EADDRINUSE: port 3000` | Another copy is running: close it, or end `node.exe` in Task Manager. |
| Speech service says CUDA not available | Install the GPU requirements (step 3) and an up-to-date NVIDIA driver, or use the CPU version. |
| "All configured providers … failed" | A free AI quota is used up for the day (Groq: ~200k tokens/day); the app moves to the next provider, try again later. |
| Out-of-memory / PC slows down | Close other heavy apps; 8 GB RAM minimum, 16 GB recommended. |

## Privacy

Use **role-played or public** audio only. The free AI tiers configured in `.env` may use submitted
data for training, so do not record real therapy or mentoring sessions with these keys.
