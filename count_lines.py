#!/usr/bin/env python3
import os
import pathlib
from collections import defaultdict

exclude_dirs = {'node_modules', 'venv', '.next', '.git', 'dist', '__pycache__', '.venv', 'env', '.pytest_cache', 'models', 'local_data', 'logs', '.vercel'}
code_exts = {'.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.md', '.yml', '.yaml', '.sql', '.html', '.css', '.scss', '.xml', '.dockerfile', '.txt', '.sh', '.bash'}

stats = defaultdict(lambda: {'files': 0, 'lines': 0})
total_lines = 0
total_files = 0

print("Scanning directory structure...")
for root, dirs, files in os.walk('.'):
    # Skip excluded directories
    dirs[:] = [d for d in dirs if d not in exclude_dirs]
    
    for file in files:
        ext = pathlib.Path(file).suffix.lower() or 'no_extension'
        
        # Only count known source code files
        if ext not in code_exts:
            continue
        
        p = pathlib.Path(root) / file
        try:
            lines = len(p.read_text(errors='ignore').splitlines())
            stats[ext]['files'] += 1
            stats[ext]['lines'] += lines
            total_lines += lines
            total_files += 1
        except:
            pass

# Print results sorted by lines of code
print("\nLines of Code by File Type:")
print("=" * 55)
print(f"{'Extension':15} {'Files':>8} {'Lines':>20}")
print("=" * 55)
for ext in sorted(stats.keys(), key=lambda x: stats[x]['lines'], reverse=True):
    data = stats[ext]
    print(f"{ext:15} {data['files']:>8} {data['lines']:>20,}")

print("=" * 55)
print(f"{'TOTAL':15} {total_files:>8} {total_lines:>20,}")
