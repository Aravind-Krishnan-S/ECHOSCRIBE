# EchoScribe v2.0 — Architecture Diagrams

---

## 1. System Overview

```mermaid
graph TB
    subgraph Client["Frontend (Vanilla JS)"]
        L[Login/Signup]
        D[Dashboard]
        R[Record Page]
        S[Summary Page]
        P[Patient Profile]
    end

    subgraph Server["Express.js Backend"]
        MW["Middleware Stack"]
        RT["API Routes"]
        CT["Controllers"]
        SV["Services"]
    end

    subgraph AI["AI Providers"]
        G["Gemini 2.5 Flash<br/>(Primary — 3 Keys)"]
        GR["Groq Llama 3.3 70B<br/>(Text Fallback)"]
        DG["Deepgram Nova-2<br/>(Audio Fallback + Diarization)"]
    end

    subgraph Storage["Data Layer"]
        SB["Supabase PostgreSQL<br/>(+ Row Level Security)"]
        ST["Supabase Storage<br/>(Audio Files)"]
    end

    subgraph Email["Communications"]
        RS["Resend API<br/>(Email)"]
    end

    Client -->|HTTPS| MW
    MW --> RT --> CT --> SV
    SV --> G
    SV --> GR
    SV --> DG
    SV --> SB
    SV --> ST
    CT --> RS
```

---

## 2. AI Multi-Provider Failover Architecture

```mermaid
graph LR
    subgraph Request["Incoming AI Request"]
        REQ["summarize / transcribe<br/>identifyRoles / profile<br/>diarize"]
    end

    subgraph Pool["Gemini Pool (Round-Robin)"]
        K1["Key 1"]
        K2["Key 2"]
        K3["Key 3"]
    end

    subgraph Validation["Lazy Validation"]
        V1{"Valid?"}
        V2{"429 Quota?"}
        V3{"3+ Errors?"}
    end

    subgraph Fallback["Fallback Layer"]
        GR["Groq Llama 3.3<br/>(Text Tasks)"]
        DG["Deepgram Nova-2<br/>(Audio STT)"]
    end

    REQ --> Pool
    K1 --> V1
    K2 --> V1
    K3 --> V1
    V1 -->|Invalid| X["Permanently Disabled"]
    V1 -->|OK| V2
    V2 -->|Yes| CD["60s Cooldown"]
    V2 -->|No| V3
    V3 -->|Yes| CD
    V3 -->|No| OK["✅ Success + _provider tag"]
    CD -->|All Exhausted| Fallback
    Fallback --> OK2["✅ Fallback Success + _provider tag"]
```

---

## 3. Request Flow (Middleware Pipeline)

```mermaid
graph TD
    REQ["HTTP Request"] --> CORS["CORS"]
    CORS --> HELMET["Helmet (Security Headers)"]
    HELMET --> BODY["Body Parser / Multer"]
    BODY --> COMP["Compliance Logger<br/>(PHI Audit)"]
    COMP --> RL{"Rate Limiter"}
    RL -->|Heavy AI: 5/min| AUTH["Auth Middleware<br/>(JWT Verify)"]
    RL -->|Light AI: 15/min| AUTH
    RL -->|General: 100/min| AUTH
    AUTH --> VAL["Zod Validation"]
    VAL --> CTRL["Controller"]
    CTRL --> SVC["Service Layer"]
    SVC --> RES["JSON Response"]
    CTRL -->|Error| ERR["Error Handler<br/>(AppError)"]
```

---

## 4. Audio Transcription + Diarization Pipeline

```mermaid
graph TD
    AUDIO["🎙️ Audio Upload<br/>(WebM/MP4/WAV, ≤25MB)"]

    AUDIO --> SPLIT{"Live Chunk<br/>or Full File?"}

    SPLIT -->|Live| GEMINI_LIVE["Gemini 2.5 Flash<br/>(Fast STT)"]
    GEMINI_LIVE --> LIVE_OUT["Live Text<br/>+ _sttProvider"]

    SPLIT -->|Full| PAR["Parallel Processing"]
    PAR --> GEMINI_STT["Gemini 2.5 Flash<br/>(Accurate Text)"]
    PAR --> DEEPGRAM["Deepgram Nova-2<br/>(Speaker Diarization)"]

    DEEPGRAM --> TURNS["Speaker Turns<br/>(speaker_0, speaker_1<br/>with timestamps)"]

    TURNS --> STATS["computeSpeakerStats()"]
    STATS --> SIGNALS["8 Contextual Signals:<br/>• Speaking time<br/>• Word count<br/>• Questions asked<br/>• Clinical vocab<br/>• Guiding phrases<br/>• Emotional phrases<br/>• Avg words/turn<br/>• Who spoke first"]

    TURNS --> MERGE["Merged Transcript<br/>(speaker_0: text...)"]

    MERGE --> ROLE_ID["identifyRoles()<br/>(Gemini + Context)"]
    SIGNALS --> ROLE_ID

    ROLE_ID --> ROLES["Role Map<br/>{speaker_0: Therapist,<br/>speaker_1: Patient}"]

    ROLES --> FINAL["Final Diarized Transcript<br/>Therapist: ...<br/>Patient: ..."]
    GEMINI_STT --> FINAL
```

---

## 5. Role Classification Logic

```mermaid
graph TD
    DG_TURNS["Deepgram Turns<br/>(speaker IDs + timestamps)"]
    
    DG_TURNS --> CSS["computeSpeakerStats()"]
    
    CSS --> S0["Speaker 0 Stats"]
    CSS --> S1["Speaker 1 Stats"]
    
    S0 --> COMPARE{"Compare Signals"}
    S1 --> COMPARE
    
    COMPARE --> Q["Questions: Who asks more?"]
    COMPARE --> C["Clinical Terms: Who uses more?"]
    COMPARE --> G["Guiding Phrases: Who directs?"]
    COMPARE --> E["Emotional Phrases: Who shares?"]
    COMPARE --> T["Turn Length: Who is shorter?"]
    COMPARE --> F["First Speaker: Who starts?"]
    
    Q --> LLM["LLM Analysis<br/>(Gemini or Groq)"]
    C --> LLM
    G --> LLM
    E --> LLM
    T --> LLM
    F --> LLM
    
    LLM --> THERAPY{"Mode?"}
    THERAPY -->|Therapy| TR["Therapist / Patient"]
    THERAPY -->|Mentoring| MR["Mentor / Mentee"]
    
    TR --> VALIDATE{"Both roles<br/>assigned?"}
    MR --> VALIDATE
    VALIDATE -->|Yes| DONE["✅ Role Map"]
    VALIDATE -->|No| DEFAULT["Default Assignment"]
```

---

## 6. Summarization & Analysis Pipeline

```mermaid
graph TD
    TRANSCRIPT["Diarized Transcript"]
    MODE{"Session Mode?"}
    
    TRANSCRIPT --> MODE
    
    MODE -->|Therapy| SOAP_PROMPT["SOAP Prompt<br/>(Clinical Specialist)"]
    MODE -->|Mentoring| GROW_PROMPT["GROW Prompt<br/>(Academic Mentor)"]
    
    SOAP_PROMPT --> GEMINI["Gemini 2.5 Flash<br/>(JSON output)"]
    GROW_PROMPT --> GEMINI
    
    GEMINI -->|Success| PARSE["Parse JSON Response"]
    GEMINI -->|Fail (3 retries)| GROQ["Groq Llama 3.3<br/>(Fallback)"]
    GROQ --> PARSE
    
    PARSE --> NORMALIZE["Normalize Fields"]
    
    NORMALIZE --> SOAP_OUT["SOAP: S/O/A/P"]
    NORMALIZE --> GROW_OUT["GROW: G/R/O/W"]
    NORMALIZE --> RISK["Risk Assessment"]
    NORMALIZE --> DIAG["Diagnostic Impressions"]
    NORMALIZE --> INTERV["Interventions Used"]
    NORMALIZE --> BOOKING["Auto-Booking"]
    NORMALIZE --> REFERRAL["Referral Form"]
    NORMALIZE --> COMMS["Patient Communication<br/>(EN + Translated)"]
    NORMALIZE --> META["Metadata<br/>(confidence, tone,<br/>topics, _provider)"]
    
    META --> SAVE["Auto-Save to Supabase"]
```

---

## 7. Database Schema (ERD)

```mermaid
erDiagram
    AUTH_USERS {
        uuid id PK
        text email
        timestamptz created_at
    }
    
    PATIENTS {
        uuid id PK
        uuid user_id FK
        text name
        int age
        text gender
        text notes
        text email
        text phone
        text entity_type "Patient or Mentee"
        timestamptz created_at
        timestamptz updated_at
    }
    
    SESSIONS {
        uuid id PK
        uuid user_id FK
        uuid patient_id FK
        text transcript
        text summary
        jsonb analysis_json "_provider, SOAP/GROW, risk, etc."
        text audio_url
        text session_mode "Therapy or Mentoring"
        timestamptz created_at
    }
    
    AUDIO_STORAGE {
        text path "user_id/timestamp_filename"
        text content_type "audio/webm"
        text bucket "session-audio"
    }
    
    AUTH_USERS ||--o{ PATIENTS : "owns"
    AUTH_USERS ||--o{ SESSIONS : "records"
    PATIENTS ||--o{ SESSIONS : "has"
    SESSIONS ||--o| AUDIO_STORAGE : "links to"
```

---

## 8. Security & Access Control Layers

```mermaid
graph TD
    subgraph Layer1["Layer 1: Network"]
        CORS["CORS Policy"]
        HELMET["Helmet Headers<br/>(CSP, HSTS, X-Frame)"]
    end
    
    subgraph Layer2["Layer 2: Rate Limiting"]
        RL_H["Heavy AI: 5/min<br/>/summarize, /profile"]
        RL_L["Light AI: 15/min<br/>/transcribe, /identify"]
        RL_G["General: 100/min<br/>all other routes"]
    end
    
    subgraph Layer3["Layer 3: Authentication"]
        JWT["JWT Bearer Token<br/>(Supabase Auth)"]
        MAGIC["Magic Link Login"]
        ADMIN["Admin Fast-Track"]
    end
    
    subgraph Layer4["Layer 4: Authorization (RLS)"]
        RLS_P["patients: user_id = auth.uid()"]
        RLS_S["sessions: user_id = auth.uid()"]
        RLS_A["audio: user_id scope"]
    end
    
    subgraph Layer5["Layer 5: Data Isolation"]
        MODE_T["Therapy Mode<br/>(entity_type = Patient)"]
        MODE_M["Mentoring Mode<br/>(entity_type = Mentee)"]
    end
    
    subgraph Layer6["Layer 6: Audit"]
        COMP["Compliance Logger<br/>(PHI_ACCESS events)"]
        REDACT["Sensitive Data Redaction<br/>([REDACTED_TRANSCRIPT])"]
    end
    
    Layer1 --> Layer2 --> Layer3 --> Layer4 --> Layer5 --> Layer6
```

---

## 9. Dual-Mode Data Isolation

```mermaid
graph LR
    subgraph TherapyMode["🏥 Therapy Mode"]
        T_PAT["Patients<br/>(entity_type = Patient)"]
        T_SES["Sessions<br/>(session_mode = Therapy)"]
        T_SOAP["SOAP Notes"]
        T_RISK["Risk: suicidal_ideation,<br/>self_harm_risk"]
        T_DIAG["Diagnostic Impressions"]
        T_MED["Medication Changes"]
    end
    
    subgraph MentoringMode["🎓 Mentoring Mode"]
        M_MEN["Mentees<br/>(entity_type = Mentee)"]
        M_SES["Sessions<br/>(session_mode = Mentoring)"]
        M_GROW["GROW Notes"]
        M_RISK["Risk: academic_burnout,<br/>severe_distress_risk"]
        M_SKILL["Skill Progression"]
        M_GOAL["Goal Completion Rate"]
    end
    
    WALL["🔒 STRICT ISOLATION<br/>No cross-mode queries"]
    
    TherapyMode --- WALL
    WALL --- MentoringMode
```

---

## 10. Frontend Page Flow

```mermaid
graph TD
    START["User Visit"] --> AUTH{"Authenticated?"}
    
    AUTH -->|No| LOGIN["Login Page<br/>(Magic Link / Admin)"]
    LOGIN --> SIGNUP["Signup Page"]
    LOGIN -->|Success| DASH
    SIGNUP -->|Success| DASH
    
    AUTH -->|Yes| DASH["Dashboard<br/>(Mode Toggle)"]
    
    DASH --> RECORD["Record Page<br/>🎙️ Live Recording"]
    DASH --> HISTORY["Session History<br/>(View / Delete)"]
    DASH --> PATIENTS["Patient List<br/>(CRUD)"]
    
    RECORD -->|Live STT| TRANSCRIBE["Real-Time Transcription<br/>(Gemini / Deepgram)"]
    RECORD -->|Upload File| UPLOAD["File Upload<br/>(≤25MB)"]
    UPLOAD --> TRANSCRIBE
    
    TRANSCRIBE --> DIARIZE["Diarization<br/>(Deepgram Nova-2)"]
    DIARIZE --> ROLES["Role Classification<br/>(Contextual AI)"]
    ROLES --> ANALYZE["Analyze<br/>(SOAP / GROW)"]
    
    ANALYZE -->|Auto-Save| SUMMARY["Summary Page"]
    SUMMARY --> EXPORT["Export<br/>(PDF / CSV / JSON)"]
    SUMMARY --> EMAIL["Send Email<br/>(Resend)"]
    SUMMARY --> HISTORY
    
    PATIENTS --> PROFILE["Patient Profile<br/>(Longitudinal AI Analysis)"]
    HISTORY --> SUMMARY
```

---

## 11. Export & Communication Flow

```mermaid
graph LR
    SESSION["Saved Session<br/>(analysis_json)"]
    
    SESSION --> PDF["PDF Export<br/>(PDFKit)"]
    SESSION --> CSV["CSV Export<br/>(json2csv)"]
    SESSION --> JSON["JSON Export<br/>(Full Record)"]
    SESSION --> EMAIL["Email<br/>(Resend API)"]
    
    PDF --> DL_PDF["📄 Download<br/>SOAP/GROW + Risk +<br/>Interventions + Comms"]
    CSV --> DL_CSV["📊 Download<br/>All Sessions Spreadsheet"]
    JSON --> DL_JSON["📦 Download<br/>Complete Data Record"]
    EMAIL --> SEND["📧 Send to Patient<br/>HTML Template"]
```
