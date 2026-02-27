import os
import sys
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

def run_audit(image_path, specification):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "ERROR: GEMINI_API_KEY not found in .env"
    
    genai.configure(api_key=api_key)
    
    # Target model: Gemini 3.1 Pro
    model = genai.GenerativeModel("gemini-3.1-pro-preview")
    
    if not os.path.exists(image_path):
        return f"ERROR: Image not found at {image_path}"

    with open(image_path, "rb") as f:
        image_data = f.read()
        
    prompt = f"""
As an independent visual quality assurance expert, validate this screenshot against the specification.

SPECIFICATION:
{specification}

INSTRUCTIONS:
1. Compare layout, colors, text content, and exact cursor visibility.
2. Determine if the image is FULLY ALIGNED with the description.
3. Provide a clear 'VERDICT: PASS' or 'VERDICT: FAIL'.
4. List specific reasons for your verdict.
5. Pay attention to small details (e.g. no distorted bars spanning the screen).
"""
    
    try:
        response = model.generate_content([prompt, {"mime_type": "image/png", "data": image_data}])
        return response.text
    except Exception as e:
        return f"ERROR: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python independent_audit.py <image_path> <description_text>")
        sys.exit(1)
    print(run_audit(sys.argv[1], sys.argv[2]))
