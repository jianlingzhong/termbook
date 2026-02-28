import os
import sys
import glob
import time
import json
import warnings
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

# Suppress noisy environment and deprecation warnings
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*OpenSSL.*")
warnings.filterwarnings("ignore", message=".*Python 3.9.*")

import google.generativeai as genai
from dotenv import load_dotenv
from PIL import Image
import io

load_dotenv()

# Limit concurrency to avoid aggressive rate limiting
MAX_THREADS = 3
report_lock = threading.Lock()

# Fallback chain for models
MODEL_FALLBACKS = [
    "models/gemini-3.0-pro-preview",
    "models/gemini-3.0-flash",
    "models/gemini-2.0-flash",
    "models/gemini-1.5-flash",
    "models/gemini-pro-latest"
]

def audit_image(dummy_model, filepath, checklist, attempts=2):
    """Audits a single image multiple times and takes the majority vote (Threaded)."""
    filename = os.path.basename(filepath)
    try:
        img = Image.open(filepath)
        checklist_str = "\n".join([f"- {q}" for q in checklist])
        
        prompt = f"""
You are a strict QA Visual Automation Bot.
Verify the attached screenshot against this checklist.

CHECKLIST:
{checklist_str}

INSTRUCTIONS:
1. Answer YES or NO for each checklist item.
2. If NO, explain why in the explanation field.
3. final_verdict should be PASS only if ALL items are YES, otherwise FAIL.
4. Return your response ONLY as a JSON object with the following structure:
{{
  "items": [
    {{ "question": "...", "answer": "YES/NO", "explanation": "..." }},
    ...
  ],
  "final_verdict": "PASS/FAIL"
}}
IMPORTANT UI CONTEXT:
- Cell headers have TWO parts:
  1. LEFT SIDE (Command): Starts with a '❯' arrow, followed by the command (e.g. 'ls').
  2. RIGHT SIDE (Breadcrumb): Shows a directory path (e.g. 'personal/termbook').
- When asked about the "command" or "❯", look at the LEFT side of the header.
- The RIGHT side directory path is NOT the command.
- If the command wraps to multiple lines, the header should expand.
"""

        results = []
        for i in range(attempts):
            success = False
            for model_name in MODEL_FALLBACKS:
                try:
                    print(f"  [{filename}] Attempt {i+1} using {model_name}...")
                    active_model = genai.GenerativeModel(model_name)
                    response = active_model.generate_content(
                        [prompt, img],
                        generation_config={
                            "response_mime_type": "application/json",
                            "temperature": 0.1
                        }
                    )
                    text = response.text.strip()
                    if text.startswith("```json"):
                        text = text[7:].strip()
                    if text.endswith("```"):
                        text = text[:-3].strip()
                    data = json.loads(text)
                    results.append(data)
                    print(f"  [{filename}] Attempt {i+1} response received from {model_name}.")
                    success = True
                    break
                except Exception as e:
                    if "429" in str(e):
                        print(f"  [{filename}] 429 quota with {model_name}, trying fallback...")
                        time.sleep(2 + i)
                        continue
                    else:
                        # For other errors (like 404), move to next model
                        continue
            if not success:
                print(f"  [{filename}] Attempt {i+1} failed across all available models.")

        if not results:
            return {"filepath": filepath, "error": f"All attempts failed for {filepath}"}

        verdicts = [r['final_verdict'] for r in results]
        final_verdict = Counter(verdicts).most_common(1)[0][0]
        best_result = next(r for r in results if r['final_verdict'] == final_verdict)
        
        print(f"  [+] Completed {filename}")
        return {
            "filepath": filepath,
            "best_result": best_result,
            "all_results": results
        }
    except Exception as e:
        return {"filepath": filepath, "error": str(e)}

def write_to_report(report_path, result):
    with report_lock:
        with open(report_path, "a") as f:
            if "error" in result:
                f.write(f"## ERROR ({os.path.basename(result.get('filepath', 'unknown'))})\n{result['error']}\n---\n\n")
            else:
                filepath = result['filepath']
                filename = os.path.basename(filepath)
                best_result = result['best_result']
                all_results = result['all_results']

                f.write(f"## {filename}\n")
                f.write(f"![{filename}]({filepath})\n\n")
                
                for item in best_result['items']:
                    f.write(f"- {item['question']}: **{item['answer']}**\n")
                    if item.get('explanation'):
                        f.write(f"  - _Explanation_: {item['explanation']}\n")
                
                f.write(f"\n**FINAL VERDICT: {best_result['final_verdict']}**\n")
                if len(all_results) > 1 and len(set([res['final_verdict'] for res in all_results])) > 1:
                    f.write(f"_(Note: Consensus reached. Raw votes: {Counter([res['final_verdict'] for res in all_results])})_\n")
                
                f.write("---\n\n")
            f.flush()

def audit_all():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found")
        return

    genai.configure(api_key=api_key)

    checklist_path = "screenshots/audit_checklist.json"
    if not os.path.exists(checklist_path):
        print(f"ERROR: {checklist_path} not found. Run generate_checklist_json.py first.")
        return

    with open(checklist_path, "r") as f:
        master_checklist = json.load(f)

    if not master_checklist:
        print("No screenshots found in checklist.")
        return

    report_path = "CHECKLIST_AUDIT.md"
    with open(report_path, "w") as f:
        f.write(f"# Checklist Visual Audit (Robust Parallel with Fallbacks)\n\n")

    print(f"Starting Threaded Audit (Max {MAX_THREADS} threads with Model Fallbacks)...")
    image_tasks = [f for f in master_checklist.keys() if os.path.exists(f)]
    print(f"Processing {len(image_tasks)} images...")
    
    with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
        future_to_file = {executor.submit(audit_image, None, f, master_checklist[f]): f for f in image_tasks}
        for future in as_completed(future_to_file):
            result = future.result()
            write_to_report(report_path, result)

    print(f"Audit complete: {report_path}")

if __name__ == "__main__":
    audit_all()
