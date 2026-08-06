"""
Fix all empty 'with' blocks in main.py by inserting 'pass'
"""
import re

path = r"C:\Users\MR__CODER__\Desktop\stokscan_AI\api\main.py"

with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

fixed = []
i = 0
count = 0
while i < len(lines):
    fixed.append(lines[i])
    # Detect a 'with ...:' line
    stripped = lines[i].rstrip()
    if re.search(r'^\s+with\s+.+:\s*$', stripped):
        indent = len(lines[i]) - len(lines[i].lstrip())
        # Look ahead: next non-empty line
        j = i + 1
        while j < len(lines) and lines[j].strip() == "":
            j += 1
        if j < len(lines):
            next_stripped = lines[j].rstrip()
            next_indent = len(lines[j]) - len(lines[j].lstrip())
            # If next real line is at same or lesser indent → block is empty
            if next_indent <= indent:
                # Insert pass at indent+4
                pass_line = " " * (indent + 4) + "pass\n"
                fixed.append(pass_line)
                count += 1
                print(f"  Fixed empty 'with' at line {i+1}: inserted pass")
    i += 1

with open(path, "w", encoding="utf-8") as f:
    f.writelines(fixed)

print(f"\nDone. Fixed {count} empty 'with' block(s).")
