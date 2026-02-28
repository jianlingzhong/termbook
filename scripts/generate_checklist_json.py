
import json
import os

base_ui_questions = [
    "Is the screen free of any major visual corruption (text overlapping, tofu blocks)?",
    "Is the overall layout clean and professionally aligned?",
    "Is the main content area background dark?"
]

cell_questions = [
    "Is the command in the cell header fully visible and correctly formatted?",
    "Does the layout properly accommodate long commands (wrapping or expanding)?"
]

tui_modal_questions = [
    "Is the background a dark, semi-transparent overlay (allowing the main area to be faintly visible)?",
    "Is the TUI window clearly visible and centered (or maximized) with a dark background?",
    "Is there a window header with red/yellow/green traffic light buttons?",
    "Is the screen free of visual artifacts or corruption?"
]

checklist_map = {
    "01_app_load.png": [
        "Is the main notebook area completely empty (no cells)?",
        "Is the sidebar showing a '+' icon or button for sessions?",
        "Is the input box empty with placeholder text?"
    ],
    "02_session_created.png": [
        "Is there a new session item in the sidebar?",
        "Is the new session highlighted as active?"
    ],
    "03_typing_ls.png": [
        "Does the input box contain the text 'ls'?",
        "Is the text color white/light grey?"
    ],
    "04_ls_output.png": base_ui_questions + cell_questions + [
        "Is there a notebook cell visible in the main area?",
        "Does the cell header show the command '❯ ls'?",
        "Does the cell output list items like 'backend/', 'frontend/', 'package.json', or 'tests/'?",
        "Is the output text monospace font?"
    ],
    "05_typing_pwd.png": [
        "Does the input box contain the text 'pwd'?"
    ],
    "06_pwd_output.png": base_ui_questions + cell_questions + [
        "Is there a notebook cell for 'pwd'?",
        "Is the output of 'pwd' a single line path?",
        "Is the vertical spacing compact (no massive empty space below the path)?",
        "Does the cell output fill the available width (not constrained to the far left)?"
    ],
    "06_autoscroll.png": [
         "Are multiple cells visible?",
         "Is the most recent cell fully visible above the input box?",
         "Is the layout un-obscured?",
         "Are old cells pushed upwards as new ones are added?"
    ],
    "08_echo_output.png": base_ui_questions + cell_questions + [
        "Is there a cell showing the 'echo' output (long line of dashes)?",
        "Does the output text use the full width of the cell (no premature wrapping)?"
    ],
    "14_nvim_modal_open.png": tui_modal_questions + [
        "Are there line numbers or standard editor characters running down the left side?",
        "Is there a status bar at the very BOTTOM of the screen?",
        "Is the status bar NOT floating in the middle of the screen?"
    ],
    "15_nvim_normal_cursor.png": tui_modal_questions + [
        "Is the nvim status bar visible at the bottom?",
        "Is there a solid CYAN BLOCK cursor at the start of the first line?",
        "Is the cursor clearly visible against the black background?"
    ],
    "16_nvim_insert_mode.png": tui_modal_questions + [
        "Does the status bar say 'INSERT'?",
        "Is the cursor shape a THIN VERTICAL BAR (or distinct from block)?",
        "Is the cursor color cyan?"
    ],
    "17_nvim_typing.png": tui_modal_questions + [
        "Is the text 'Line 1: Visual Audit' visible?",
        "Is the cursor positioned after the typed text?",
        "Is the font monospace and crisp?"
    ],
    "18_nvim_esc_normal.png": tui_modal_questions + [
        "Has the status bar returned to NORMAL mode (no 'INSERT')?",
        "Has the cursor reverted to a BLOCK shape?"
    ],
    "19_nvim_move_k.png": tui_modal_questions + [
        "Is the block cursor now on the FIRST line of text?"
    ],
    "20_nvim_move_h.png": tui_modal_questions + [
        "Is the block cursor positioned on a character other than the last one (moved left)?"
    ],
    "21_nvim_move_l.png": tui_modal_questions + [
        "Is the block cursor positioned on a character other than the first one (moved right)?"
    ],
    "22_nvim_move_j.png": tui_modal_questions + [
        "Is the block cursor moved DOWN to the next line?"
    ],
    "23_nvim_visual_mode.png": tui_modal_questions + [
        "Is there a highlighted selection of text?",
        "Does the status bar indicate VISUAL mode?"
    ],
    "24_nvim_command_mode.png": tui_modal_questions + [
        "Is the screen free of visual corruption (no overlapping text or tofu blocks)?",
        "Is there a ':' prompt at the bottom left?"
    ],
    "25_nvim_closed.png": base_ui_questions + [
        "Is the nvim modal completely gone?",
        "Is the notebook view visible again?"
    ],
    "26_cat_output.png": base_ui_questions + [
        "Is there a new cell showing the 'cat' command?",
        "Does the output show the file content correctly?"
    ],
    "27_switch_session_1.png": base_ui_questions + [
        "Is the first session highlighted in the sidebar?",
        "Does the notebook show the correct content for session 1 (not blank)?"
    ],
    "28_switch_session_2.png": base_ui_questions + [
        "Is the second session highlighted in the sidebar?",
        "Does the notebook show the correct content for session 2 (not blank)?"
    ],
    "29_ghost_text.png": base_ui_questions + [
        "Does the input box show suggested/ghost text in a dimmed color?"
    ],
    "08_long_command_header.png": base_ui_questions + cell_questions + [
        "Is the command in the cell header fully visible even if it is very long?",
        "Does the command area expand to show multiple lines for long commands?",
        "Is there a scrollbar or indicator if the command is exceptionally long (exceeding max-height)?"
    ],
    "cell_growth_live.png": base_ui_questions + [
        "Is a notebook cell currently running (e.g. orange pulse or active border)?",
        "Does the cell height accurately fit the current output lines (no massive gaps)?",
        "Does the output fill the full width?"
    ],
    "comp_sidebar.png": [
        "Is the sidebar background semi-transparent or dark?",
        "Is the 'SESSIONS' title visible?",
        "Is there a '+' button for new sessions?"
    ],
    "comp_header.png": [
        "Is the breadcrumb path clearly visible?",
        "Is there a folder icon next to the path?"
    ],
    "comp_input.png": [
        "Is the '❯' arrow cyan colored?",
        "Is the input box border glowing or clearly defined?"
    ],
    "comp_nvim_cursor_normal.png": [
        "Is the cursor a solid block shape?",
        "Is the cursor color cyan?"
    ],
    "comp_nvim_cursor_insert.png": [
        "Is the cursor shape a thin vertical bar?",
        "Is the cursor color cyan?"
    ]
}

def get_final_checklist(filename):
    if filename in ["14_nvim_modal_open.png", "15_nvim_normal_cursor.png", "16_nvim_insert_mode.png", 
                    "17_nvim_typing.png", "18_nvim_esc_normal.png", "19_nvim_move_k.png", 
                    "20_nvim_move_h.png", "21_nvim_move_l.png", "22_nvim_move_j.png", 
                    "23_nvim_visual_mode.png", "24_nvim_command_mode.png"]:
        return checklist_map.get(filename, tui_modal_questions + ["Is the screen free of visual corruption?"])
    
    specifics = checklist_map.get(filename, ["Is the screen free of visual corruption?"])
    if specifics[0] in base_ui_questions or specifics[0] in tui_modal_questions:
        return specifics
    return base_ui_questions + specifics

screenshots_dir = 'screenshots'
if not os.path.exists(screenshots_dir):
    os.makedirs(screenshots_dir)

screenshots = [f for f in os.listdir(screenshots_dir) if f.endswith('.png')]
final_json = {}

for s in screenshots:
    final_json[f"screenshots/{s}"] = get_final_checklist(s)

with open('screenshots/audit_checklist.json', 'w') as f:
    json.dump(final_json, f, indent=2)

print(f"Generated checklist for {len(screenshots)} screenshots at screenshots/audit_checklist.json")
