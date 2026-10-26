"""eval/build_conversations.py — E5 data: simulated two-speaker conversations from LibriSpeech test-clean.

Each conversation alternates 10 turns between two speakers (5 each, one utterance per turn, 0.3-0.9 s gaps,
no overlap). Speaker pairs are distinct across conversations and mixed-gender where possible.
Three conditions per conversation:
  clean  — as recorded
  snr5   — babble (3 other test-clean speakers) + pink noise, mixed at 5 dB SNR
  snr0   — the same noise at 0 dB SNR
Outputs in eval/data/conversations/: <id>_<cond>.wav (16 kHz mono), <id>.rttm (reference speaker turns),
<id>.json (turn list with reference text). Seeded, so the set is reproducible.

Usage: eval/.venv/Scripts/python eval/build_conversations.py [n_conversations]
"""
import json
import random
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent
LS = ROOT / "data" / "librispeech" / "LibriSpeech"
OUT = ROOT / "data" / "conversations"
SR = 16000
N = int(sys.argv[1]) if len(sys.argv) > 1 else 12
TURNS = 10
rng = random.Random(2026)
np_rng = np.random.default_rng(2026)


def speakers_by_gender():
    genders = {}
    for line in (LS / "SPEAKERS.TXT").read_text(encoding="utf-8").splitlines():
        if line.startswith(";"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 3 and parts[2] == "test-clean":
            genders[parts[0]] = parts[1]
    return genders


def utterances(speaker):
    """[(path, text, seconds)] for one speaker, 2-12 s long."""
    out = []
    for trans in (LS / "test-clean" / speaker).glob("*/*.trans.txt"):
        for line in trans.read_text(encoding="utf-8").splitlines():
            uid, text = line.split(" ", 1)
            path = trans.parent / f"{uid}.flac"
            info = sf.info(str(path))
            dur = info.frames / info.samplerate
            if 2.0 <= dur <= 12.0:
                out.append((path, text.lower(), dur))
    return out


def pink_noise(n):
    white = np_rng.standard_normal(n)
    spectrum = np.fft.rfft(white)
    freqs = np.arange(len(spectrum))
    spectrum[1:] /= np.sqrt(freqs[1:])
    pink = np.fft.irfft(spectrum, n)
    return pink / (np.std(pink) + 1e-9)


def mix_at_snr(speech, noise, snr_db):
    p_s = np.mean(speech[np.abs(speech) > 1e-4] ** 2) if np.any(np.abs(speech) > 1e-4) else np.mean(speech ** 2)
    p_n = np.mean(noise ** 2) + 1e-12
    noise = noise * np.sqrt(p_s / (p_n * 10 ** (snr_db / 10)))
    out = speech + noise
    peak = np.max(np.abs(out))
    return out / peak * 0.95 if peak > 0.99 else out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    genders = speakers_by_gender()
    males = sorted(s for s, g in genders.items() if g == "M")
    females = sorted(s for s, g in genders.items() if g == "F")
    rng.shuffle(males)
    rng.shuffle(females)
    pairs = list(zip(males, females))
    used = {s for p in pairs[:N] for s in p}
    babble_pool = [s for s in genders if s not in used]

    manifest = []
    for i, (spk_a, spk_b) in enumerate(pairs[:N]):
        cid = f"conv{i + 1:02d}"
        pools = {spk_a: utterances(spk_a), spk_b: utterances(spk_b)}
        for pool in pools.values():
            rng.shuffle(pool)
        audio, turns, t = [], [], 0.0
        order = [spk_a, spk_b] if rng.random() < 0.5 else [spk_b, spk_a]
        for k in range(TURNS):
            spk = order[k % 2]
            path, text, _ = pools[spk].pop()
            wav, sr = sf.read(str(path), dtype="float32")
            assert sr == SR
            gap = rng.uniform(0.3, 0.9)
            audio.append(np.zeros(int(gap * SR), dtype=np.float32))
            t += gap
            start = t
            audio.append(wav)
            t += len(wav) / SR
            turns.append({"speaker": spk, "start": round(start, 3), "end": round(t, 3), "text": text})
        audio.append(np.zeros(int(0.5 * SR), dtype=np.float32))
        speech = np.concatenate(audio)

        # noise: babble from three other speakers + pink noise, same length
        babble = np.zeros_like(speech)
        for s in rng.sample(babble_pool, 3):
            track, pos = np.zeros_like(speech), 0
            utts = utterances(s)
            rng.shuffle(utts)
            for path, _, _ in utts:
                w, _ = sf.read(str(path), dtype="float32")
                if pos >= len(track):
                    break
                n = min(len(w), len(track) - pos)
                track[pos:pos + n] = w[:n]
                pos += n
            babble += track / (np.std(track) + 1e-9)
        noise = babble / 3 + 0.5 * pink_noise(len(speech))

        sf.write(str(OUT / f"{cid}_clean.wav"), speech, SR)
        sf.write(str(OUT / f"{cid}_snr5.wav"), mix_at_snr(speech, noise, 5).astype(np.float32), SR)
        sf.write(str(OUT / f"{cid}_snr0.wav"), mix_at_snr(speech, noise, 0).astype(np.float32), SR)
        with open(OUT / f"{cid}.rttm", "w", encoding="utf-8") as f:
            for tr in turns:
                f.write(f"SPEAKER {cid} 1 {tr['start']:.3f} {tr['end'] - tr['start']:.3f} <NA> <NA> {tr['speaker']} <NA> <NA>\n")
        meta = {"id": cid, "speakers": [spk_a, spk_b], "duration": round(len(speech) / SR, 2), "turns": turns}
        (OUT / f"{cid}.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        manifest.append({"id": cid, "duration": meta["duration"], "speakers": [spk_a, spk_b]})
        print(cid, f"{meta['duration']:.1f}s", spk_a, spk_b)

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print("total minutes:", round(sum(m["duration"] for m in manifest) / 60, 1))


if __name__ == "__main__":
    main()
