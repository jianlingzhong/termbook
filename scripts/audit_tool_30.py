
import os
import sys
import glob
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

def get_screenshot_description(filename):
    # Mapping for the 30-step massive audit
    descriptions = {
        "01_app_load.png": "App loaded. Sidebar (left) with 'New Session' button. Main area empty. Input box at bottom.",
        "02_session_created.png": "Sidebar shows active session '# sess-...'. Breadcrumb in header shows path.",
        "03_typing_ls.png": "Input box shows text 'ls'.",
        "04_ls_output.png": "Notebook cell with 'ls' command. Output lists files (backend, frontend, etc). Light text, dark bg.",
        "05_typing_pwd.png": "Input box shows text 'pwd'.",
        "06_pwd_output.png": "Notebook cell with 'pwd' command. Output shows path. Cell structure visible.",
        "07_typing_echo.png": "Input box shows 'echo "Hello World"'.",
        "08_echo_output.png": "Notebook cell with 'echo' command. Output 'Hello World'.",
        "09_typing_invalid.png": "Input box shows invalid command.",
        "10_invalid_output.png": "Notebook cell shows error message/stderr output.",
        "11_typing_mkdir.png": "Input box 'mkdir audit_dir'.",
        "12_mkdir_output.png": "Notebook cell 'mkdir', no output or success confirmation.",
        "13_cd_output.png": "Notebook cell 'cd audit_dir'. Breadcrumb might update.",
        "14_nvim_modal_open.png": "Dark centered modal. Nvim interface visible. Status bar at BOTTOM.",
        "15_nvim_normal_cursor.png": "Nvim Normal Mode. Cyan BLOCK cursor at (1,1).",
        "16_nvim_insert_mode.png": "Nvim Insert Mode. Status bar '-- INSERT --'.",
        "17_nvim_typing.png": "Nvim with text entered. Cursor at end.",
        "18_nvim_esc_normal.png": "Nvim back to Normal. Block cursor.",
        "19_nvim_move_k.png": "Nvim cursor moved UP.",
        "20_nvim_move_h.png": "Nvim cursor moved LEFT.",
        "21_nvim_move_l.png": "Nvim cursor moved RIGHT.",
        "22_nvim_move_j.png": "Nvim cursor moved DOWN.",
        "23_nvim_visual_mode.png": "Nvim Visual Mode. Selection highlighted.",
        "24_nvim_command_mode.png": "Nvim Command Mode (:). Colon at bottom.",
        "25_nvim_closed.png": "Modal closed. Back to notebook view.",
        "26_cat_output.png": "Notebook cell 'cat'. Shows file content.",
        "27_switch_session_1.png": "Sidebar session 1 active.",
        "28_switch_session_2.png": "Sidebar session 2 active.",
        "29_ghost_text.png": "Input box shows ghost text suggestion.",
        "30_delete_session.png": "Sidebar session deleted."
    }
    # Fallback for the audit_* ones if they are still there
    if filename.startswith("audit_"):
         return "Legacy audit screenshot. Check for visual anomalies."
    return descriptions.get(filename, "A screenshot of the Termbook application.")

def audit_all(model_name):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found")
        return

    genai.configure(api_key=api_key)
    try:
        model = genai.GenerativeModel(model_name)
    except:
        model = genai.GenerativeModel("gemini-1.5-pro") # Fallback

    # Target the numeric screenshots first
    files = sorted(glob.glob("frontend/screenshots/[0-9]*.png"))
    
    if not files:
        print("No numbered screenshots found.")
        return

    report_path = "FINAL_30_STEP_AUDIT.md"
    with open(report_path, "w") as f:
        f.write(f"# 30-Step Visual Audit Report ({model_name})\n\n")
        
        for filepath in files:
            filename = os.path.basename(filepath)
            print(f"Auditing {filename}...")
            desc = get_screenshot_description(filename)
            
            with open(filepath, "rb") as img:
                img_data = img.read()
                
            prompt = f"""
            Validate screenshot: {filename}
            Spec: {desc}
            
            Check:
            1. UI layout (Sidebar, Input, Cells/Modal)
            2. Cursor visibility/shape (Block vs Bar)
            3. Font rendering (Clean monospace?)
            
            Output format:
            **Verdict:** PASS/FAIL
            **Reasoning:** ...
            """
            
            try:
                response = model.generate_content([prompt, {"mime_type": "image/png", "data": img_data}])
                f.write(f"## {filename}\n")
                f.write(f"![{filename}]({filepath})\n\n")
                f.write(f"**Spec:** {desc}\n\n")
                f.write(f"{response.text}\n")
                f.write("---\n\n")
            except Exception as e:
                f.write(f"## {filename} - ERROR\n{e}\n")

if __name__ == "__main__":
    # Prefer the model the user requested if available, else default
    # The previous turn confirmed we have gemini-2.0-pro-exp and others
    # We will try to use the best one.
    model = "gemini-2.0-pro-exp-02-05" 
    if len(sys.argv) > 1: model = sys.argv[1]
    audit_all(model)

