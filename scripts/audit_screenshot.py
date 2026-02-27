
import os
import sys
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

def audit_image(image_path, spec):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key: return "ERROR: Missing GEMINI_API_KEY"
    genai.configure(api_key=api_key)
    # Using Gemini 3.1 Pro Preview as requested
    model = genai.GenerativeModel("models/gemini-3.1-pro-preview")
    
    with open(image_path, "rb") as f:
        image_data = f.read()
        
    image_parts = [{"mime_type": "image/png", "data": image_data}]
    
    prompt = f"""
As an independent visual quality assurance expert, validate this screenshot against the detailed specification below. 

SPECIFICATION:
{spec}

INSTRUCTIONS:
1. Compare layout, colors, text content, and exact cursor visibility.
2. Determine if the image is FULLY ALIGNED with the description.
3. Provide a clear 'VERDICT: PASS' or 'VERDICT: FAIL'.
4. List specific reasons for your verdict.
5. Small details matter (e.g. no massive cyan bars spanning the screen).
"""
    try:
        response = model.generate_content([prompt, image_parts[0]])
        return response.text
    except Exception as e:
        return f"ERROR during generation: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(1)
    print(audit_image(sys.argv[1], sys.argv[2]))

