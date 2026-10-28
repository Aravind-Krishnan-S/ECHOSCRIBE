# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary audience for now: the IEEE panel and evaluators watching a live demo of the project. The product's intended users are therapists (mental-health sessions, SOAP notes) and mentors (academic or professional coaching, GROW notes); a user signs up as Therapist, Mentor or Both, and Both switches between two workspaces.

## Product Purpose

EchoScribe turns a recorded two-person session into a structured note (SOAP for therapy, GROW for mentoring) that a clinician can trust and sign off quickly, and keeps each client's history across sessions. Success: the clinician (and the panel watching) can see why every sentence of the note is there.

## Positioning

Every sentence of a note cites the transcript turns it comes from, and a model other than the writer checks each sentence (supported / partly supported / unsupported). A note with too many unsupported sentences is regenerated on another model, and a second, independent model screens for risk so disagreement is visible. An embedded router keeps every task working across many AI vendors and keys.

## Operating Context

- Used both live (recording in the room, screen beside the clinician, must stay unobtrusive) and right after the session (review and edit the note at a laptop).
- Runs locally at http://localhost:3000; audio processing (SpeechBrain) runs on the same machine. The user brings their own API keys for cloud AI vendors (Gemini, OpenAI, Anthropic, Mistral, Groq, many others) or uses local models (Ollama, LM Studio).
- Workflow: pick workspace → client → record or upload audio → staged processing (separate speakers, transcribe, identify roles, write note, verify) → review note with evidence and risk panel → edit, export (PDF/CSV), email.

## Capabilities and Constraints

- React 19 + Vite + TypeScript + Tailwind v4 frontend served by an Express backend; Supabase for auth and data.
- Screens: login/signup with role, workspace picker, home, clients list, client detail (history and longitudinal profile), record/upload, session summary, settings (profile, models and API keys, general), spotlight tour and getting-started checklist.
- API keys stay in the browser by default; a per-key "Sync to my account" switch stores them encrypted.
- Per-task model choice: provider then model, filtered to models able to do that task.
- Risk output is model-reported and uncalibrated; the UI must keep the safety disclaimer.
- Free-tier vendors may train on data: demos use role-played sessions only.

## Evidence on Hand

- Paper results (eval/results, paper/): router fault-injection table, ACI-Bench note scores, verification and planted-error results, role accuracy, speech results.
- Role-played demo session fixture: eval/results/demo_session.json.
- No real users, testimonials or clinical validation exist; do not imply any.

## Product Principles

1. Trust is shown, not claimed: evidence and verification status sit next to every sentence.
2. Fewest steps from recording to a signed-off note.
3. The client's story over time is a first-class view, not an afterthought.
4. Calm in the room: nothing on screen should distract during a live session.
5. Honest about uncertainty: risk flags are model-reported and always reviewable by the clinician.
