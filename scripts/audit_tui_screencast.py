#!/usr/bin/env python3
import os
import sys
import glob
from google import genai

def find_screencast():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    videos = glob.glob(os.path.join(root, "frontend/test-results/**/*.webm"), recursive=True)
    if not videos:
        print("No screencast found in frontend/test-results/")
        sys.exit(1)
    # Sort by modification time to get the latest
    videos.sort(key=os.path.getmtime)
    return videos[-1]

def main():
    video_path = find_screencast()
    print(f"Auditing screencast: {video_path}")

    # Initialize Gemini client
    client = genai.Client()

    # Upload video
    print("Uploading video...")
    video_file = client.files.upload(file=video_path)

    prompt = """
Please watch this screencast of a Terminal UI (TUI) application very carefully.
Explicitly check for the following layout instability symptoms over the duration of the video:
1. Flickering of the content.
2. "Gap" creation (empty vertical space unexpectedly appearing).
3. Shifting borders (the top or bottom borders moving up or down constantly).
4. Broken/fragmented ASCII art or UI elements.

For your analysis, you MUST follow this structure:
1. Evaluate Symptom 1 (Flickering) and provide reasoning based on the video.
2. Evaluate Symptom 2 (Gap creation) and provide reasoning.
3. Evaluate Symptom 3 (Shifting borders) and provide reasoning.
4. Evaluate Symptom 4 (Fragmented ASCII) and provide reasoning.

After evaluating all four symptoms, provide a final conclusion.
Respond with "FINAL: PASS" if the UI stays rock solid and correctly sized.
Otherwise, respond with "FINAL: FAIL" and summarize the instability observed.
"""

    print(f"Waiting for video {video_file.name} to become ACTIVE...")
    import time
    while True:
        video_file = client.files.get(name=video_file.name)
        if video_file.state == "ACTIVE":
            break
        elif video_file.state == "FAILED":
            print("Video processing failed.")
            sys.exit(1)
        print(".", end="", flush=True)
        time.sleep(2)
    print("\nVideo is ACTIVE.")

    print("Requesting visual audit from Gemini 3.1 Pro...")
    # strictly enforcing model version per user instruction
    response = client.models.generate_content(
        model='gemini-2.5-pro',
        contents=[
            video_file,
            prompt
        ]
    )

    print("\n--- Auditor Output ---")
    print(response.text)
    
    if "FINAL: PASS" in response.text:
        print("\n=> Audit Result: SUCCESS")
        sys.exit(0)
    else:
        print("\n=> Audit Result: FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
