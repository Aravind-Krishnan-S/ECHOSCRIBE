# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
[private vulnerability reporting](https://github.com/Aravind-Krishnan-S/ECHOSCRIBE/security/advisories/new)
for this repository, and include the steps to reproduce. We aim to acknowledge a report within a week.

## What this project protects

- Keys live in `.env` (never committed) or, if a user chooses to sync one, encrypted at rest with AES-256-GCM
  (`src/services/key-vault.js`). API responses return only a key's family, label and last four characters.
- Records are separated per user by PostgreSQL Row-Level Security, and therapy and mentoring records are
  separated by a mode column that every query must state.
- EchoScribe is research software. It is **not** a medical device, and its risk flags are model-reported and
  uncalibrated. Do not use it with real patient data unless your institution has approved the model vendors
  you configure; free-tier vendors may use submitted text for training.
