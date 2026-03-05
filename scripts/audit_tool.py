
import os
import sys
import glob
import base64
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

def get_screenshot_description(filename):
    """Returns a specific description for known audit screenshots."""
    descriptions = {
        "01_app_load.png": "Initial load: Dark theme, Sidebar (left) with 'New Session' button, Header (top) with folder icon, Main area (empty), Input box (bottom) with cyan prompt.",
        "02_session_created.png": "Session created: Sidebar active item '# sess-...', Main area shows breadcrumb path. Input box focused.",
        "03_typing_ls.png": "Input box: Text 'ls' is typed. Ghost text (if any) might appear.",
        "04_ls_output.png": "Main area: A notebook cell shows command 'ls'. Output list includes 'backend', 'frontend', 'package.json'. Light text on dark bg.",
        "05_typing_pwd.png": "Input box: Text 'pwd' is typed.",
        "06_pwd_output.png": "Main area: New cell with 'pwd'. Output shows current directory path. Cell should be compact.",
        "14_nvim_modal_open.png": "Nvim Modal: Large centered dark window. Nvim interface visible (tildes '~'). Status bar at BOTTOM. Cyan block cursor at top-left.",
        "15_nvim_normal_cursor.png": "Nvim Normal: Solid CYAN BLOCK cursor at Row 1 Col 1. No massive bars.",
        "16_nvim_insert_mode.png": "Nvim Insert: Status bar shows '-- INSERT --'.",
        "17_nvim_typing.png": "Nvim Typing: Text 'Line 1...' visible. Cursor at end of text should be THIN VERTICAL CYAN BAR.",
        "18_nvim_esc_normal.png": "Nvim Normal Return: Cursor reverts to CYAN BLOCK.",
        "26_cat_output.png": "Main area: 'cat' command output showing text file content.",
        "audit_01_restored_ui.png": "Restored UI: Glassmorphism sidebar, Cyan accents, Correct font (JetBrains Mono).",
        "audit_03_nvim_normal.png": "Nvim Normal Fix: Cyan BLOCK cursor at (1,1). Terminal fills modal (no floating status bar).",
        "audit_04_nvim_insert.png": "Nvim Insert Fix: Cyan BAR cursor at end of text.",
        "audit_06_hydration.png": "Hydration: All previous cells restored correctly. Scroll position maintained.",
        "audit_07_stderr.png": "Stderr: Command 'ls' failed. Output should be distinct (ideally red/dimmed) to indicate error.",
        "audit_08_long_line_wrap.png": "Line Wrap: Extremely long line of text. Verify it wraps at the terminal edge without horizontal scrolling or clipping.",
        "audit_09_scrolling.png": "Scrolling: 100 lines of output. Verify a vertical scrollbar exists inside the cell and the layout remains stable.",
        "audit_10_binary_data.png": "Binary/Chaos: Base64 random data. Verify no encoding artifacts or broken layout containers.",
        "audit_11_resize_stability.png": "Resize: Captures state after viewport resize. Verify content is not truncated and cell height remains consistent (480px).",
        "audit_12_text_selection.png": "Selection: Dragging over text. Verify a visible highlight/selection overlay exists on the characters.",
        "audit_13_mobile_view.png": "Mobile: Viewport set to iPhone 12. Verify the input box is visible and accessible, and elements are correctly scaled for a small screen."
    }
    return descriptions.get(filename, "A screenshot of the Termbook terminal application. Verify UI consistency, layout, and cursor visibility.")

def audit_all(model_name):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found in .env")
        return

    genai.configure(api_key=api_key)
    try:
        model = genai.GenerativeModel(model_name)
    except Exception as e:
        print(f"Error initializing model {model_name}: {e}")
        return

    screenshot_dir = os.path.join(os.getcwd(), "frontend", "screenshots")
    files = sorted(glob.glob(os.path.join(screenshot_dir, "audit_*.png")))
    
    if not files:
        print(f"No screenshots found in {screenshot_dir}")
        return

    report_path = "FINAL_VISUAL_AUDIT.md"
    with open(report_path, "w") as report:
        report.write(f"# Termbook Visual Audit Report\n")
        report.write(f"**Model:** {model_name}\n")
        report.write(f"**Date:** {os.popen('date').read().strip()}\n\n")

        for filepath in files:
            filename = os.path.basename(filepath)
            print(f"Auditing {filename}...")
            
            desc = get_screenshot_description(filename)
            
            with open(filepath, "rb") as img_file:
                img_data = img_file.read()
                
            prompt = f"""
            As a QA expert, validate this screenshot against:
            "{desc}"
            
            1. Layout/Colors/Fonts correct?
            2. Cursor shape/color correct? (Block=Normal, Bar=Insert)
            3. Any visual glitches?
            
            Verdict: PASS/FAIL. Reason.
            """
            
            try:
                response = model.generate_content([prompt, {"mime_type": "image/png", "data": img_data}])
                analysis = response.text
            except Exception as e:
                analysis = f"**Error generating analysis:** {e}"

            # Embed image using relative path for local viewing or base64 for portability
            # Using relative path for Markdown previewers that support it relative to md file
            rel_path = f"frontend/screenshots/{filename}"
            
            report.write(f"## {filename}\n")
            report.write(f"![{filename}]({rel_path})\n\n")
            report.write(f"**Specification:** {desc}\n\n")
            report.write(f"**LLM Analysis:**\n{analysis}\n\n")
            report.write("---\n\n")

    print(f"Audit complete. Report saved to {report_path}")

if __name__ == "__main__":
    model = sys.argv[1] if len(sys.argv) > 1 else "gemini-1.5-pro"
    audit_all(model)

