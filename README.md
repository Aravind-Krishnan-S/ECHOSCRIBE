# 🩺 EchoScribe

**AI-powered clinical documentation platform with dual-stream speech-to-text, speaker diarization, SOAP note generation, longitudinal client intelligence, and unified audio storage.**

[![Live Demo](https://img.shields.io/badge/Live-echoscribe--vert.vercel.app-blueviolet?style=for-the-badge)](https://echoscribe-vert.vercel.app)

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎙️ **Dual-Architecture Transcription** | Live speech-to-text via Groq Whisper with instant visual feedback, backed by pristine Deepgram Nova-2 diarization for the final transcript |
| 🗣️ **Native Speaker Diarization** | Deepgram AI instantly differentiates between Counsellor & Patient (via audio + LLM role identification) |
| 🗄️ **Integrated Audio Storage** | Recorded and uploaded sessions are auto-saved to secure Supabase Storage buckets, enabling playback directly on the Session Summary |
| 📁 **File Uploads** | Batch-upload pre-recorded clinical MP3, WAV, WEBM, OGG, FLAC, M4A files for instant bulk analysis |
| 🌐 **Multilingual Core** | Full support for English, Malayalam, Tamil, Hindi, Spanish, French, German, Japanese, Korean, Chinese, Portuguese, Arabic |
| 📋 **Clinical SOAP Notes** | AI-generated Subjective, Objective, Assessment, and Plan summaries |
| 📈 **Patient Insights Dashboard** | Beautiful Chart.js visual analytics tracking longitudinal Topic distributions (Polar charts) and Emotional Tones (Doughnut charts) |
| ⚠️ **Risk Assessment** | Automated detection and flagging for self-harm and suicidal ideation risks |
| 👤 **Patient Hub & CMS** | Create, edit, and intelligently track linked session histories |
| 🧠 **Intelligent Profiling** | Cross-session continuous profiling highlighting therapeutic momentum, recurring themes, and treatment effectiveness |
| 📄 **Data Export** | Professional one-click clinical exports to PDF, CSV, and JSON |
| ⚡ **Vercel Edge Ready** | Fully optimized for Serverless execution with bypassed `os.tmpdir()` logic to support heavy Audio Multer buffering |
| 🔐 **Authentication & RLS** | Supabase Auth mapped directly to PostgreSQL Row-Level Security for HIPPA structural emulation |

---

## 🗣️ Deepgram Diarization Pipeline

EchoScribe completely bypasses generic LLM hallucinating by natively using **Deepgram** for high-fidelity audio diarization.

1. **Dual-Recorder Streaming**: During a live session, the frontend streams micro-chunks to Groq Whisper for instant visual feedback on-screen. Concurrently, a perfect contiguous WebM blob is maintained silently in the background.
2. **Post-Processing**: Upon clicking *Analyze*, the full blob is piped directly to Deepgram's `nova-2` endpoint alongside local file uploads.
3. **Turn Identification**: Deepgram maps the raw dialogue into timestamps and generic identities. Finally, an LLM pass intelligently tags exactly which speaker is the **Counsellor** and which is the **Patient** based on clinical context structure.

---

## 🛠️ Tech Stack & Architecture

- **Backend:** Node.js, Express, Helmet, CORS, Rate Limiting (Optimized for Vercel Serverless Functions)
- **AI (STT/Diarization):** Deepgram SDK (Final Audio), Groq Whisper Large V3 (Live Visual Chunks)
- **AI (Analysis):** Groq SDK (Llama 3.3 70B Fast inference)
- **Database/Storage:** Supabase (PostgreSQL tables, Authentication, SQL Row-Level-Security, Cloud Object Storage for `.webm/.mp4`)
- **Audio Pipeline:** Native MediaRecorder browser API piped to Multer buffer logic 
- **Frontend / Vis:** Vanilla HTML/CSS/JS with `Chart.js` for data visualization.

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
│   │   ├── deepgram.service.js        # Deepgram Nova-2 Integration
│   │   └── db.service.js              # RLS-aware Supabase CRUD + Audio Storage Bucket
│   ├── controllers/
│   │   ├── auth.controller.js         # signup, login, logout, refresh
│   │   ├── session.controller.js      # summarize, save metadata + audioUrl mapping
│   │   ├── transcribe.controller.js   # groq vs deepgram audio ingestion
│   │   ├── patient.controller.js      # patient CMS & chart data prep
│   │   ├── profile.controller.js      # longitudinal client generation
│   │   └── export.controller.js       # PDF, CSV, JSON export
│   ├── routes/
│   │   ├── auth.routes.js             # /api/auth/*
│   │   └── api.routes.js              # /api/* (protected with Multipart Multer)
│   ├── docs/swagger.js                # OpenAPI 3.0 spec
│   └── index.js                       # Primary Entry Point
├── public/
│   ├── index.html / app.js            # Recorder page, audio Blob aggregation
│   ├── summary.html / summary.js      # SOAP display, Risk cards, HTML5 Audio Player
│   ├── patient.html / patient.js      # Chart.js Dashboard and insight visualizations
│   ├── dashboard.html                 # Main patient directory CMS
│   ├── style.css                      # Unified design tokens (dark/light map)
├── supabase/
│   ├── create_patients_table.sql      # Patients table RLS constraints
│   └── setup_audio_storage.sql        # session-audio Bucket configuration
├── vercel.json                        # Serverless function timeout overrides
├── .env.example                       # Environment template
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

4. **Initialize Audio Storage** — run `supabase/setup_audio_storage.sql` to create the `session-audio` bucket and its Row Level Security rules.

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
