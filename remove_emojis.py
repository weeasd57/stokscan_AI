#!/usr/bin/env python3
"""Remove emoji characters from Python files to fix Windows encoding issues."""

import re
import sys

def remove_emojis_from_file(file_path):
    """Remove non-ASCII characters from print statements while preserving code."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original_content = content
    
    # Replace emojis with descriptive labels in print statements
    replacements = {
        r'❌': '❌',  # Will be stripped
        r'✅': '✅',  # Will be stripped
        r'🚀': '🚀',  # Will be stripped
        r'⚠️': '⚠️',   # Will be stripped
        r'🧠': '🧠',  # Will be stripped
        r'🎯': '🎯',  # Will be stripped
        r'⏱️': '⏱️',   # Will be stripped
        r'📥': '📥',  # Will be stripped
        r'🏛️': '🏛️',  # Will be stripped
        r'👑': '👑',  # Will be stripped
        r'💾': '💾',  # Will be stripped
        r'🛡️': '🛡️',  # Will be stripped
    }
    
    # Replace print statements with emoji to use ASCII labels only
    patterns = [
        # ❌ → [ERROR]
        (r'print\s*\(\s*f?"❌\s+([^"]*)"', lambda m: f'print(f"[ERROR] {m.group(1)}"'),
        (r'print\s*\(\s*f?"❌\s+', 'print(f"[ERROR] '),
        
        # ✅ → [OK]
        (r'print\s*\(\s*f?"✅\s+', 'print(f"[OK] '),
        
        # 🚀 → [START]
        (r'print\s*\(\s*f?"🚀\s+', 'print(f"[START] '),
        
        # ⚠️ → [WARNING]
        (r'print\s*\(\s*f?"⚠️\s+', 'print(f"[WARNING] '),
        
        # 🧠 → [AI]
        (r'print\s*\(\s*f?"🧠\s+', 'print(f"[AI] '),
        
        # 🎯 → [TARGET]
        (r'print\s*\(\s*f?"🎯\s+', 'print(f"[TARGET] '),
        
        # ⏱️ → [TIME]
        (r'print\s*\(\s*f?"⏱️\s+', 'print(f"[TIME] '),
        
        # 📥 → [INPUT]
        (r'print\s*\(\s*f?"📥\s+', 'print(f"[INPUT] '),
        
        # 🏛️ → [COUNCIL]
        (r'print\s*\(\s*f?"🏛️\s+', 'print(f"[COUNCIL] '),
        
        # 👑 → [KING]
        (r'print\s*\(\s*f?"👑\s+', 'print(f"[KING] '),
        
        # 💾 → [SAVE]
        (r'print\s*\(\s*f?"💾\s+', 'print(f"[SAVE] '),
        
        # 🛡️ → [PROTECT]
        (r'print\s*\(\s*f?"🛡️\s+', 'print(f"[PROTECT] '),
    ]
    
    for pattern, replacement in patterns:
        if isinstance(replacement, str):
            content = re.sub(pattern, replacement, content)
        else:
            content = re.sub(pattern, replacement, content)
    
    # Remove any remaining emojis
    # This is a broad approach - remove any character that's not ASCII
    lines = content.split('\n')
    new_lines = []
    for line in lines:
        # Keep the line but remove emojis
        try:
            # For print statements, replace non-ASCII with ASCII equivalent
            if 'print(' in line:
                # Remove emoji from print statements
                line = ''.join(c if ord(c) < 128 else '' for c in line)
        except:
            pass
        new_lines.append(line)
    
    content = '\n'.join(new_lines)
    
    # Write back
    if content != original_content:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

if __name__ == '__main__':
    import glob
    
    files_to_fix = [
        'api/backtest_radar.py',
        'api/backtest_optimizer.py',
        'api/ingest_index.py',
        'api/stock_ai.py',
        'api/live_bot.py',
    ]
    
    for file_pattern in files_to_fix:
        for file_path in glob.glob(file_pattern):
            print(f"Processing {file_path}...")
            if remove_emojis_from_file(file_path):
                print(f"  -> Fixed")
            else:
                print(f"  -> No changes needed")
