import os
import sys
import google.generativeai as genai
from PIL import Image

def run_audit():
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print("GEMINI_API_KEY environment variable not set. Skipping LLM audit.")
        sys.exit(0)

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-2.5-pro')

    img_before_path = os.path.join("frontend", "audit_tui_before_clear.png")
    img_after_path = os.path.join("frontend", "audit_tui_after_clear.png")

    if not os.path.exists(img_before_path) or not os.path.exists(img_after_path):
        print(f"Error: Could not find screenshots at {img_before_path} or {img_after_path}")
        sys.exit(1)

    img_before = Image.open(img_before_path)
    img_after = Image.open(img_after_path)

    prompt = """
Look at these two sequential screenshots.
1. First screenshot shows red lines (Line 1 to 10).
2. Second screenshot shows green lines (New Frame 1 to 5) after the screen is cleared.

Did the terminal cell jump, shrink, or change its relative vertical position compared to the sidebar during the transition? (Ideally, the terminal cell should retain its size or at least not jump drastically when it shrinks). Actually, the terminal should NEVER shrink based on the high-water mark logic.
So, did the terminal cell shrink? (i.e. did the bottom border or prompt input area move UP compared to the first screenshot?)
Did the terminal cell jump?

Are the true colors (Red then Green) visible and correct?

Answer strictly with YES or NO for each question, then provide a brief explanation.
Format:
JUMPED_OR_SHRANK: [YES/NO]
TRUECOLORS_VISIBLE: [YES/NO]
EXPLANATION: [Your explanation]
    """

    print("Sending screenshots to Gemini for audit...")
    response = model.generate_content([prompt, img_before, img_after])
    text = response.text
    print("\n--- Gemini Output ---")
    print(text)
    print("---------------------\n")

    if "JUMPED_OR_SHRANK: YES" in text.upper():
        print("FAIL: The terminal cell jumped or shrank.")
        sys.exit(1)
        
    if "TRUECOLORS_VISIBLE: NO" in text.upper():
        print("FAIL: True colors are not visible or correct.")
        sys.exit(1)
        
    print("PASS: Audit successful.")
    sys.exit(0)

if __name__ == "__main__":
    run_audit()
