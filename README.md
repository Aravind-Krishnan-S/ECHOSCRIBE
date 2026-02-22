# 🩺 EchoScribe

**AI-powered clinical documentation platform with speech-to-text, speaker diarization, SOAP note generation, and longitudinal client intelligence.**

[![Live Demo](https://img.shields.io/badge/Live-echoscribe--vert.vercel.app-blueviolet?style=for-the-badge)](https://echoscribe-vert.vercel.app)

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎙️ **Groq Whisper Transcription** | Real-time speech-to-text powered by Groq Whisper Large V3 with timestamp segments |
| 🗣️ **Speaker Diarization** | Voice-based pitch analysis (live) + LLM-based conversation analysis (uploaded files) to differentiate Counsellor & Patient |
| 📁 **Audio File Upload** | Upload pre-recorded audio files (MP3, WAV, WEBM, OGG, FLAC, M4A) for transcription & analysis |
| 🌐 **Multilingual Support** | English, Malayalam, Tamil, Hindi, Spanish, French, German, Japanese, Korean, Chinese, Portuguese, Arabic |
| 📋 **Clinical SOAP Notes** | AI generates Subjective, Objective, Assessment, and Plan sections |
| ⚠️ **Risk Assessment** | Automatic suicidal ideation and self-harm risk detection |
| 📊 **Analytics Dashboard** | KPI cards, emotional tone charts, session activity graphs |
| 👤 **Patient Management** | Create, edit, and track patients with linked session histories |
| 🧠 **Client Profiling** | Longitudinal analysis across 20+ sessions — recurring themes, emotional trends, treatment effectiveness |
| 📄 **PDF/CSV/JSON Export** | Professional clinical documentation export |
| 🔐 **Authentication** | Supabase Auth with JWT, auto-refresh, and Row-Level Security |
| 🌗 **Dark/Light Theme** | Persistent theme toggle across all pages |
| 📖 **Swagger API Docs** | Interactive API documentation at `/api/docs` |

---

## 🗣️ Speaker Diarization

EchoScribe uses a **hybrid approach** to differentiate speakers:

### Live Recording
1. **Web Audio API** captures real-time voice pitch via autocorrelation every 200ms
2. Speaker profiles are built dynamically — if pitch differs by >30Hz, a new speaker is detected
3. Transcript segments are labeled as **Person 1** / **Person 2** during recording

### Uploaded Audio Files
1. **Groq Whisper** transcribes the full audio with timestamps
2. **LLM analysis** (Llama 3.3 70B) identifies speaker turns from conversation flow — Q&A patterns, topic shifts, response cues
3. Segments are labeled as **Person 1** / **Person 2**

### Role Identification
After recording/upload, clicking **Analyze (SOAP)** triggers:
1. LLM identifies which person is the **Counsellor** vs **Patient** based on therapeutic language, questioning style, and content
2. The SOAP note is generated with role-aware analysis

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, Helmet, CORS, Rate Limiting
- **AI — Transcription:** Groq Whisper Large V3 (multilingual speech-to-text)
- **AI — Analysis:** Groq SDK (Llama 3.3 70B) for SOAP notes, speaker identification, diarization
- **Database:** Supabase (PostgreSQL) with Row-Level Security
- **Auth:** Supabase Auth (email/password, JWT)
- **Audio Processing:** Web Audio API (pitch detection), MediaRecorder API
- **Export:** PDFKit, json2csv
- **Validation:** Zod schemas on all endpoints
- **Frontend:** Vanilla HTML/CSS/JS, Chart.js

---

## 📁 Project Structure

```
ECHOSCRIBE/
├── src/
│   ├── config/env.js                  # Zod environment validation
│   ├── middleware/
│   │   ├── security.js                # Helmet, CORS, rate limiting
│   │   ├── auth.js                    # JWT auth middleware
│   │   ├── validate.js                # Zod request validation
│   │   └── errorHandler.js            # AppError class + asyncHandler
│   ├── services/
│   │   ├── ai.service.js              # Whisper STT, SOAP, diarization, profiles
│   │   └── db.service.js              # RLS-aware Supabase CRUD
│   ├── controllers/
│   │   ├── auth.controller.js         # signup, login, logout, me, refresh
│   │   ├── session.controller.js      # summarize, save, history
│   │   ├── transcribe.controller.js   # audio transcription + speaker diarization
│   │   ├── patient.controller.js      # patient CRUD
│   │   ├── profile.controller.js      # longitudinal client profile
│   │   └── export.controller.js       # PDF, CSV, JSON export
│   ├── routes/
│   │   ├── auth.routes.js             # /api/auth/*
│   │   └── api.routes.js              # /api/* (protected)
│   ├── docs/swagger.js                # OpenAPI 3.0 spec
│   └── index.js                       # Entry point
├── public/
│   ├── index.html                     # Recorder page (record + upload)
│   ├── app.js                         # MediaRecorder, Whisper, pitch analysis
│   ├── summary.html / summary.js      # SOAP note display + charts
│   ├── dashboard.html                 # Patient management + analytics
│   ├── login.html / login.js          # Login page
│   ├── signup.html / signup.js        # Signup page
│   ├── auth-guard.js                  # Token management + authFetch
│   ├── style.css                      # Main stylesheet (dark/light)
│   ├── card.css                       # Summary card styles
│   └── modal.css                      # Profile modal styles
├── supabase/
│   └── create_patients_table.sql      # Patients table + RLS setup
├── .env.example                       # Environment template
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+
- **Supabase** account ([supabase.com](https://supabase.com))
- **Groq** API key ([console.groq.com](https://console.groq.com))

### 1. Clone & Install

```bash
git clone https://github.com/Aravind-Krishnan-S/ECHOSCRIBE.git
cd ECHOSCRIBE/ECHOSCRIBE
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```env
GROQ_API_KEY=gsk_your_groq_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_anon_key
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*
```

### 3. Set Up Supabase

1. **Enable Email/Password Auth:** Supabase Dashboard → Authentication → Providers → Email → Enable

2. **Run the database setup SQL** in SQL Editor:

```sql
-- Create sessions table
CREATE TABLE sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transcript TEXT,
  summary TEXT,
  analysis_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_created_at ON sessions(created_at DESC);

-- Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions" ON sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions" ON sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions" ON sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions" ON sessions
  FOR DELETE USING (auth.uid() = user_id);
```

3. **Create patients table** — run `supabase/create_patients_table.sql` in the SQL Editor.

### 4. Start the Server

```bash
# Development (with hot reload)
npm run dev

# Production
npm start
```

Open **http://localhost:3000** in your browser.

---

## 📡 API Endpoints

### Authentication (Public)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/signup` | Create account |
| `POST` | `/api/auth/login` | Login (returns JWT) |
| `POST` | `/api/auth/logout` | Logout |
| `GET` | `/api/auth/me` | Get current user |
| `POST` | `/api/auth/refresh` | Refresh JWT token |

### Protected (Requires Bearer Token)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/transcribe-audio` | Transcribe audio via Groq Whisper (multipart upload) |
| `POST` | `/api/diarize-transcript` | LLM-based speaker turn identification |
| `POST` | `/api/identify-speakers` | Identify Counsellor vs Patient roles |
| `POST` | `/api/summarize` | Generate SOAP note from transcript |
| `POST` | `/api/session` | Save session to database |
| `GET` | `/api/history` | Get all user sessions |
| `GET` | `/api/profile` | Generate longitudinal client profile |
| `GET` | `/api/patients` | List all patients |
| `POST` | `/api/patients` | Create patient |
| `PUT` | `/api/patients/:id` | Update patient |
| `DELETE` | `/api/patients/:id` | Delete patient |
| `GET` | `/api/export/pdf/:id` | Export session as PDF |
| `GET` | `/api/export/csv` | Export all sessions as CSV |
| `GET` | `/api/export/json/:id` | Export session as JSON |

Interactive docs available at **`/api/docs`** (Swagger UI).

---

## 🌐 Supported Languages

| Language | Code |
|---|---|
| English (US/UK/India) | `en` |
| Malayalam | `ml` |
| Hindi | `hi` |
| Tamil | `ta` |
| Spanish | `es` |
| French | `fr` |
| German | `de` |
| Japanese | `ja` |
| Korean | `ko` |
| Chinese (Mandarin) | `zh` |
| Portuguese (Brazil) | `pt` |
| Arabic | `ar` |

> Language-specific prompts are used to condition Whisper for maximum accuracy. Select the correct language **before** recording or uploading.

---

## 🔒 Security

- **Helmet** for HTTP security headers
- **CORS** with configurable origins
- **Rate Limiting** — 10 req/min for AI endpoints, 100 req/min general
- **Zod** schema validation on all request bodies
- **Supabase RLS** — users can only access their own data
- **JWT** with automatic token refresh on 401

---

## 📸 Pages

| Page | URL | Description |
|---|---|---|
| Login | `/login` | Email/password authentication |
| Sign Up | `/signup` | Account creation |
| Recorder | `/` | Record audio or upload files with speaker detection |
| Clinical Summary | `/summary` | SOAP note with risk assessment, charts, export |
| Dashboard | `/dashboard` | Patient management, KPIs, emotional tone, session activity |

---

## ⚠️ Limitations

- **File upload size:** 4.5MB max on Vercel (serverless function limit). For larger files, run locally.
- **Speaker diarization:** Voice pitch detection works best with distinctly different voices. LLM-based diarization for uploaded files is context-dependent.
- **Groq rate limits:** Free tier has API rate limits. Consider a paid plan for production use.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is developed by [Aravind Krishnan S](https://github.com/Aravind-Krishnan-S).

---

<p align="center">
  Built with ❤️ using Groq AI & Supabase
</p>
