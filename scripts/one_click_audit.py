import os
import subprocess
import time
import sys
from dotenv import load_dotenv

def run_command(cmd, cwd=None):
    print(f"[*] Executing: {cmd}")
    process = subprocess.Popen(cmd, shell=True, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if process.stdout:
        for line in process.stdout:
            print(line, end='')
    process.wait()
    return process.returncode

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    load_dotenv(os.path.join(root_dir, ".env"))
    
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[!] ERROR: GEMINI_API_KEY not found in .env file.")
        sys.exit(1)

    print("=== TERMBOOK ONE-CLICK LLM AUDIT ===")
    
    # 1. Ensure servers are running
    print("\n[1/4] Checking server status...")
    run_command("python3 manage_debug_servers.py status", cwd=root_dir)
    
    # 2. Run Playwright to generate screenshots
    print("\n[2/4] Generating fresh audit screenshots via Playwright...")
    # Clean up old ones first
    run_command("rm -rf frontend/screenshots/audit_*.png", cwd=root_dir)
    ret = run_command("npx playwright test tests/comprehensive_audit.spec.js --project=chromium", cwd=os.path.join(root_dir, "frontend"))
    
    # 3. Collect screenshots
    print("\n[3/4] Collecting artifacts...")
    # Playwright puts them in the CWD (frontend/) because we used explicit paths
    run_command("mv frontend/audit_*.png frontend/screenshots/", cwd=root_dir)
    
    # Check if any were found
    if not os.listdir(os.path.join(root_dir, "frontend", "screenshots")):
        print("[!] WARNING: No audit screenshots were found in frontend/test-results.")
    
    # 4. Run the LLM Audit
    print("\n[4/4] Starting LLM Visual Analysis (gemini-3.1-pro-preview)...")
    run_command("python3 scripts/audit_tool.py 'gemini-3.1-pro-preview'", cwd=root_dir)

    print("\n=== AUDIT COMPLETE ===")
    print(f"Report available at: {os.path.join(root_dir, 'FINAL_VISUAL_AUDIT.md')}")

if __name__ == "__main__":
    main()
