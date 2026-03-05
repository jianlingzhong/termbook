#!/usr/bin/env python3
import os
import sys
import glob
from google import genai

import glob
import time
import json
from google import genai
from google.genai import types
import subprocess

def get_video_duration(path):
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True
        )
        return float(result.stdout.strip())
    except Exception:
        return 0

def find_screencast():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # Look for videos, prioritizing deterministic names if we ever add them, but otherwise the latest webm
    videos = glob.glob(os.path.join(root, "frontend/test-results/**/*.webm"), recursive=True)
    if not videos:
        print("[-] No screencast found in frontend/test-results/")
        sys.exit(1)
    
    # Filter by duration > 2s
    valid_videos = []
    for v in videos:
        duration = get_video_duration(v)
        if duration > 2:
            valid_videos.append((v, duration))
    
    if not valid_videos:
        print("[-] No valid screencasts (duration > 2s) found.")
        sys.exit(1)
        
    # Sort by modification time to get the latest valid one
    valid_videos.sort(key=lambda x: os.path.getmtime(x[0]))
    return valid_videos[-1][0]

def main():
    video_path = find_screencast()
    print(f"[*] Auditing screencast: {video_path}")

    # Initialize Gemini client
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[-] GEMINI_API_KEY not set.")
        sys.exit(1)
        
    client = genai.Client(api_key=api_key)

    # Upload video with retries
    print("[*] Uploading video...")
    max_retries = 3
    video_file = None
    for attempt in range(max_retries):
        try:
            video_file = client.files.upload(file=video_path)
            break
        except Exception as e:
            print(f"[-] Upload attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                sys.exit(1)

    print(f"[*] Waiting for video {video_file.name} to become ACTIVE...")
    start_time = time.time()
    while True:
        video_file = client.files.get(name=video_file.name)
        if video_file.state == "ACTIVE":
            break
        elif video_file.state == "FAILED":
            print("[-] Video processing failed.")
            sys.exit(1)
        if time.time() - start_time > 300: # 5 min timeout
            print("[-] Timeout waiting for video to process.")
            sys.exit(1)
        print(".", end="", flush=True)
        time.sleep(5)
    print("\n[+] Video is ACTIVE.")

    prompt = """
Analyze this screencast of a Terminal UI (TUI) application (Termbook). 
The application uses a Shadow Buffer / SSR model to render terminal output into a notebook-like interface.

SYSTEM_VERSION: v1.1
TASK: Audit for layout instability and rendering artifacts.

CHECKLIST:
1. FLICKERING: Does the content flash or disappear/reappear rapidly?
2. GAPS: Are there unexpected empty vertical lines appearing inside the terminal area?
3. JUMPING: Does the entire terminal window or its borders shift position unexpectedly?
4. FRAGMENTATION: Are UI elements like borders, boxes, or ASCII art broken or misaligned?
5. CURSOR: In TUI mode (like nvim), is the cursor visible and correctly shaped (block in normal, bar in insert)?

RESPONSE_FORMAT (JSON):
{
  "symptoms": {
    "flickering": {"observed": boolean, "details": string},
    "gaps": {"observed": boolean, "details": string},
    "jumping": {"observed": boolean, "details": string},
    "fragmentation": {"observed": boolean, "details": string},
    "cursor_issue": {"observed": boolean, "details": string}
  },
  "analysis": "Brief summary of observations",
  "status": "PASS" | "FAIL"
}

RULES:
- Only PASS if ALL symptoms are false and UI is perfectly stable.
- If any significant instability is seen, status MUST be FAIL.
- Return ONLY the JSON object.
"""

    print("[*] Calling Gemini API...")
    try:
        response = client.models.generate_content(
            model='gemini-3.1-pro-preview', # Use a more stable model name unless strictly required otherwise
            contents=[
                video_file,
                prompt
            ],
            config=types.GenerateContentConfig(
                response_mime_type='application/json'
            )
        )
    except Exception as e:
        print(f"[-] Gemini API call failed: {e}")
        sys.exit(1)

    print("\n--- Auditor Output ---")
    try:
        result = json.loads(response.text)
        print(json.dumps(result, indent=2))
        
        if result.get("status") == "PASS":
            print("\n[+] Audit Result: SUCCESS (PASS)")
            sys.exit(0)
        else:
            print(f"\n[-] Audit Result: FAILED (FAIL)")
            print(f"    Reason: {result.get('analysis')}")
            sys.exit(1)
    except Exception as e:
        print(f"[-] Failed to parse Gemini response: {e}")
        print(f"Raw response: {response.text}")
        sys.exit(1)

if __name__ == "__main__":
    main()
