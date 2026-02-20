# EchoScribe Project Walkthrough

EchoScribe is a real-time speech-to-text web application that leverages modern AI to transcribe audio and generate intelligent summaries.

## Core Features

### 1. Real-time Transcription
- **Microphone Integration**: Uses the browser's Web Audio API to capture live audio.
- **WebSocket Streaming**: Sends audio chunks to the server for processing.
- **Deepgram/Groq Integration**: Utilizes industry-leading models for fast and accurate transcription.

### 2. Intelligent Summarization
- **AI-Powered Analysis**: Uses Groq (Llama-3) to analyze transcribed text.
- **Rich Insights**: Generates a summary, key bullet points, detailed analysis, and sentiment assessment.
- **Dynamic UI**: Displays results in a beautifully styled summary page once the recording ends.

### 3. Database Integration
- **Supabase**: Saves transcriptions and summaries for persistent storage and retrieval.

## Technical Architecture

### Frontend
- **HTML/CSS/JS**: Vanilla implementation for maximum performance.
- **Responsive Design**: Uses `card.css` for a premium, modern aesthetic.
- **State Management**: Handles recording states, UI updates, and navigation between the main recorder and summary views.

### Backend
- **Node.js & Express**: Provides the server infrastructure.
- **Environment Variables**: Managed via `.env` for secure API key storage.
- **API Endpoints**: 
    - `/api/summarize`: Handles the communication with Groq for AI analysis.
    - Supabase Client: Manages data flow to the cloud database.

## How to Get Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Setup Environment**:
   Create a `.env` file with `GROQ_API_KEY`, `SUPABASE_URL`, and `SUPABASE_KEY`.
3. **Run the Server**:
   ```bash
   node server.js
   ```
4. **Access the App**:
   Open `http://localhost:3000` in your browser.
