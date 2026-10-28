# SpeechBrain baseline (the design in the first submission)

EchoScribe originally removed noise with SepFormer and separated speakers with ECAPA-TDNN
embeddings and spectral clustering. Measured in `eval/audio_eval.js` (Table III), denoising raised
speech-recognition word error rates and the clustering had 19-27% DER, so the app now uses
pyannote community-1 on the original recording (`src/python/speech_service.py`).

This folder keeps the old service so the baseline rows of Table III can be reproduced:

    python -m venv .venv && .venv\Scripts\pip install -r requirements.txt   (torch 2.7.1 CPU)
    .venv\Scripts\python speechbrain_service.py                              (port 5050)
    node eval/audio_eval.js 12

Model checkpoints are read from `src/python/pretrained_models` (override with SPEECHBRAIN_MODEL_DIR).
