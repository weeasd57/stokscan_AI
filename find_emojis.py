import glob
import os

# Find all Python files with problematic emojis or unicode
issues = []
for pyfile in glob.glob("api/**/*.py", recursive=True):
    try:
        with open(pyfile, 'r', encoding='utf-8') as f:
            content = f.read()
            # Check for emoji patterns
            if any(ord(c) > 127 for c in content):  # Non-ASCII
                for line_num, line in enumerate(content.split('\n'), 1):
                    if any(ord(c) > 127 for c in line) and ('print' in line or 'log' in line or 'send' in line):
                        issues.append(f"{pyfile}:{line_num}: {repr(line[:80])}")
    except Exception as e:
        pass

print(f"Found {len(issues)} potential encoding issues:")
for issue in issues[:30]:
    print(issue)
