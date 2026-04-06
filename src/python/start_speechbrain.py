"""
EchoScribe — SpeechBrain Startup Script
========================================
Installs dependencies and starts the SpeechBrain microservice.

Usage:
  python src/python/start_speechbrain.py
"""

import subprocess
import sys
import os

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    req_file = os.path.join(script_dir, "requirements.txt")

    print("[SpeechBrain Setup] Installing dependencies...")
    print("  This may take a few minutes on first run (PyTorch + SpeechBrain ~2GB)")
    print()

    try:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-r", req_file, "-q"
        ])
        print("[SpeechBrain Setup] ✅ Dependencies installed")
    except subprocess.CalledProcessError as e:
        print(f"[SpeechBrain Setup] ❌ Failed to install dependencies: {e}")
        sys.exit(1)

    print("[SpeechBrain Setup] Starting SpeechBrain service...")
    print("  Models will be downloaded from HuggingFace on first run (~210MB)")
    print()

    service_file = os.path.join(script_dir, "speechbrain_service.py")
    try:
        subprocess.run([sys.executable, service_file], check=True)
    except KeyboardInterrupt:
        print("\n[SpeechBrain] Server stopped by user")
    except subprocess.CalledProcessError as e:
        print(f"\n[SpeechBrain] ❌ Server crashed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
