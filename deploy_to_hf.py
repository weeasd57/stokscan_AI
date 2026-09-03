"""
deploy_to_hf.py — رفع ملفات الكود لـ HuggingFace Space مباشرة
================================================================
الاستخدام:
    pip install huggingface_hub   (مرة واحدة فقط)
    python deploy_to_hf.py

لماذا هذا الأسلوب؟
    git push hf main لا يعمل لأن HuggingFace بقت ترفض ملفات LFS
    وتطلب نظام Xet الجديد للملفات الثنائية (.pkl models).
    هذا السكريبت يتجاوز المشكلة برفع ملفات الكود النصية مباشرة.

ملاحظة:
    ملفات الـ Models (.pkl) وملفات symbols_data/ لا تحتاج رفع —
    هي موجودة بالفعل على HuggingFace ويتم توليدها وقت التشغيل.
"""
from huggingface_hub import HfApi
import os
import sys

# Force UTF-8 encoding on standard output and error to prevent UnicodeEncodeError under Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ─── الإعدادات ─────────────────────────────────────────────────────────
HF_TOKEN = os.getenv("HF_TOKEN", "")  # set via: $env:HF_TOKEN="hf_your_token_here"
REPO_ID  = "weeasdwee/AI_BOT"
REPO_TYPE = "space"
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))

# ─── الملفات المراد رفعها (تلقائياً من Git) ──────────────────────────────────
import subprocess

def get_git_changes():
    files = set()
    try:
        # Files changed since the Hugging Face Space baseline deployment 23 days ago
        res = subprocess.run(["git", "diff", "--name-only", "78cc5e6", "HEAD"], capture_output=True, text=True)
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                if line.strip():
                    files.add(line.strip())
        
        # Files modified but not committed yet
        res = subprocess.run(["git", "diff", "--name-only"], capture_output=True, text=True)
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                if line.strip():
                    files.add(line.strip())
                    
        # Untracked files
        res = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                if line.startswith("?? "):
                    files.add(line[3:].strip())
    except Exception as e:
        print(f"⚠ Warning reading git status: {e}")
    
    # Filter and format paths
    valid_files = []
    for f in sorted(files):
        clean_path = f.replace("\\", "/").strip()
        local_path = os.path.join(BASE_DIR, clean_path.replace("/", os.sep))
        if os.path.isfile(local_path):
            # Exclude large binary/cache files or package managers
            if any(x in clean_path for x in [".git/", "package-lock.json", "node_modules/", "deploy_to_hf.py"]):
                continue
            
            # Only include backend code running on Hugging Face Space (api/ folder, root python files, scripts/, Dockerfile, requirements.txt)
            is_backend = (
                (clean_path.startswith("api/") and not clean_path.startswith("api/symbols_data/")) or 
                (clean_path.endswith(".py") and not clean_path.startswith("web/")) or
                clean_path.startswith("scripts/") or
                clean_path in ["requirements.txt", "Dockerfile", "README.md"]
            )
            if not is_backend:
                continue
                
            valid_files.append(clean_path)
    return valid_files

# Fallback hardcoded list if git fails
HARDCODED_FILES = [
    "api/daily_bot_run.py",
    "api/free_data_provider.py",
    "api/macro_correlation.py",
    "api/main.py",
    "api/routers/admin.py",
    "api/telegram_bot.py",
    "api/routers/scan_tech.py",
    "web/src/app/scanner/market/MarketClient.tsx"
]

FILES_TO_UPLOAD = get_git_changes()
if not FILES_TO_UPLOAD:
    FILES_TO_UPLOAD = HARDCODED_FILES

if not HF_TOKEN:
    raise SystemExit("❌ Set HF_TOKEN environment variable first:\n   $env:HF_TOKEN='hf_your_token_here'")

from huggingface_hub import CommitOperationAdd

api = HfApi(token=HF_TOKEN)
print(f"\n🚀 Preparing {len(FILES_TO_UPLOAD)} files for upload to {REPO_ID}...\n")

operations = []
for rel_path in FILES_TO_UPLOAD:
    local_path = os.path.join(BASE_DIR, rel_path.replace("/", os.sep))
    if not os.path.exists(local_path):
        print(f"  ⚠  SKIP (not found): {rel_path}")
        continue
    
    operations.append(
        CommitOperationAdd(
            path_in_repo=rel_path,
            path_or_fileobj=local_path
        )
    )
    print(f"  📦 Staged: {rel_path}")

if operations:
    print(f"\n⚡ Sending atomic commit with {len(operations)} files to Hugging Face...")
    try:
        api.create_commit(
            repo_id=REPO_ID,
            repo_type=REPO_TYPE,
            operations=operations,
            commit_message="deploy: update backend code and binary models",
            create_pr=True
        )
        print("✅ Atomic deployment successful! Only 1 commit created.")
    except Exception as e:
        print(f"❌ Atomic commit failed: {e}")
        raise SystemExit(1)
else:
    print("⚠ No files to upload.")
