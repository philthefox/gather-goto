#!/usr/bin/env python3
"""Generates, signs and opens the macOS Shortcuts that call gather-goto.

    python3 shortcuts/build_shortcuts.py            # all shortcuts
    python3 shortcuts/build_shortcuts.py "Gather - AFK"

Each run opens an "Add Shortcut" dialog per file in the Shortcuts app. Re-importing a
shortcut creates a second copy; delete the old one there. Shortcuts > Settings > Advanced >
"Allow Running Scripts" must be on. Edit BIN, DIRECT and MENU to taste.
"""
import os, pathlib, plistlib, subprocess, sys, uuid

BIN = os.path.expanduser("~/.local/bin/gather-goto")
DIRECT = {  # name -> argument          (one-shot shortcuts, good for a hotkey)
    "Gather - Desk": "desk",
    "Gather - AFK": "afk",
    "Gather - Customer call": "customer",
    "Gather - Koi Pond": "koi",
}
MENU = ["Desk", "Customer call", "AFK", "Koi Pond", "Zen Space", "Lobby Couches", "Boardroom", "The Loop", "Blue Room", "Green Room"]
OUT = pathlib.Path(__file__).parent / "build"

def base(actions, glyph=59680):
    return {"WFWorkflowActions": actions, "WFWorkflowClientVersion": "2607.1.3",
            "WFWorkflowIcon": {"WFWorkflowIconGlyphNumber": glyph, "WFWorkflowIconStartColor": 431817727},
            "WFWorkflowImportQuestions": [], "WFWorkflowInputContentItemClasses": [], "WFWorkflowTypes": [],
            "WFWorkflowMinimumClientVersion": 900, "WFWorkflowMinimumClientVersionString": "900",
            "WFWorkflowHasShortcutInputVariables": False, "WFWorkflowHasOutputFallback": False,
            "WFWorkflowOutputContentItemClasses": [], "WFQuickActionSurfaces": []}

def shell(script):
    return {"WFWorkflowActionIdentifier": "is.workflow.actions.runshellscript",
            "WFWorkflowActionParameters": {"Script": script, "Shell": "/bin/zsh", "InputMode": "to stdin"}}

def menu_shortcut():
    lu, cu, prefix = str(uuid.uuid4()).upper(), str(uuid.uuid4()).upper(), f'{BIN} "'
    return base([
        {"WFWorkflowActionIdentifier": "is.workflow.actions.list", "WFWorkflowActionParameters": {"UUID": lu, "WFItems": MENU}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.choosefromlist", "WFWorkflowActionParameters": {
            "UUID": cu, "WFChooseFromListActionPrompt": "Where to?",
            "WFInput": {"Value": {"OutputUUID": lu, "OutputName": "List", "Type": "ActionOutput"}, "WFSerializationType": "WFTextTokenAttachment"}}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.runshellscript", "WFWorkflowActionParameters": {
            "Shell": "/bin/zsh", "InputMode": "to stdin",
            "Script": {"Value": {"string": prefix + "￼" + '"',
                                 "attachmentsByRange": {f"{{{len(prefix)}, 1}}": {"OutputUUID": cu, "OutputName": "Chosen Item", "Type": "ActionOutput"}}},
                       "WFSerializationType": "WFTextTokenString"}}}])

def main():
    OUT.mkdir(exist_ok=True)
    wanted = sys.argv[1:]
    docs = {name: base([shell(f"{BIN} {arg}")], 59511) for name, arg in DIRECT.items()}
    docs["Gather - Go to"] = menu_shortcut()
    for name, doc in docs.items():
        if wanted and name not in wanted: continue
        raw, signed = OUT / f"{name}.unsigned.shortcut", OUT / f"{name}.shortcut"
        with open(raw, "wb") as f: plistlib.dump(doc, f)
        subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(raw), "--output", str(signed)], check=True)
        raw.unlink(); subprocess.run(["open", str(signed)], check=True); print("opened", signed.name)

if __name__ == "__main__": main()
