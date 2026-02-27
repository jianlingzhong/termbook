
import os
import sys
import base64
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

def audit_image(image_path, description):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "ERROR: GEMINI_API_KEY not found."
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-1.5-pro')
    with open(image_path, "rb") as f:
        image_data = f.read()
    image_parts = [{"mime_type": "image/png", "data": image_data}]
    prompt = f"As a visual QA, validate this screenshot. Spec: {description}. Provide VERDICT: PASS/FAIL and detailed reasons."
    try:
        response = model.generate_content([prompt, image_parts[0]])
        return response.text
    except Exception as e:
        return f"ERROR: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(1)
    with open(sys.argv[2], 'r') as f: description = f.read()
    print(audit_image(sys.argv[1], description))
