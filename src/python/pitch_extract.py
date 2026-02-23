import sys
import json
import librosa
import numpy as np
import warnings
warnings.filterwarnings('ignore')

def get_pitch(audio_path, segments):
    try:
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        
        speaker_pitches = {}
        speaker_counts = {}
        
        for seg in segments:
            speaker = str(seg.get('speaker', '0'))
            start_time = float(seg.get('start', 0))
            end_time = float(seg.get('end', 0))
            
            start_sample = int(start_time * sr)
            end_sample = int(end_time * sr)
            
            y_seg = y[start_sample:end_sample]
            if len(y_seg) == 0:
                continue
                
            # Use piptrack for speed over pyin (which is very slow)
            pitches, magnitudes = librosa.piptrack(y=y_seg, sr=sr)
            
            # Select the frequencies with highest magnitude
            f0 = []
            for t in range(pitches.shape[1]):
                index = magnitudes[:, t].argmax()
                pitch = pitches[index, t]
                if pitch > 0:
                    f0.append(pitch)
                    
            if len(f0) > 0:
                if speaker not in speaker_pitches:
                    speaker_pitches[speaker] = 0.0
                    speaker_counts[speaker] = 0
                
                # Filter out crazy outliers (human voice is typically 60Hz to 300Hz)
                f0 = np.array(f0)
                valid_f0 = f0[(f0 > 60) & (f0 < 300)]
                if len(valid_f0) > 0:
                    speaker_pitches[speaker] += np.mean(valid_f0)
                    speaker_counts[speaker] += 1
                    
        results = {}
        # Calculate final averages
        for spk in speaker_pitches:
            if speaker_counts[spk] > 0:
                results[spk] = float(speaker_pitches[spk] / speaker_counts[spk])
            else:
                results[spk] = 0.0
                
        print(json.dumps({"success": True, "pitches": results}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Missing arguments"}))
        sys.exit(1)
        
    try:
        audio_path = sys.argv[1]
        segments = json.loads(sys.argv[2])
        get_pitch(audio_path, segments)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
