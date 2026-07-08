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

# ─── الإعدادات ─────────────────────────────────────────────────────────
HF_TOKEN = os.getenv("HF_TOKEN", "")  # set via: $env:HF_TOKEN="hf_your_token_here"
REPO_ID  = "weeasdwee/AI_BOT"
REPO_TYPE = "space"
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))

# ─── الملفات المراد رفعها ─────────────────────────────────────────────
# عدّل هذه القائمة لتشمل الملفات التي تغيرت في آخر commit
FILES_TO_UPLOAD = [
    # Python Backend (changed in this deploy)
    "api/daily_bot_run.py",
    "api/free_data_provider.py",
    "api/macro_correlation.py",
    "api/main.py",
    "api/routers/admin.py",
    "api/telegram_bot.py",
    "api/scripts/update_market_cache.py",
    "api/symbols_data/market_status.json",
    # Frontend Telegram channel update
    "web/src/app/profile/page.tsx",
    "web/src/app/scanner/backtests/BacktestsClient.tsx",
]

if not HF_TOKEN:
    raise SystemExit("❌ Set HF_TOKEN environment variable first:\n   $env:HF_TOKEN='hf_your_token_here'")

api = HfApi(token=HF_TOKEN)
print(f"\n🚀 Uploading {len(FILES_TO_UPLOAD)} files to {REPO_ID}...\n")

success, failed = 0, []

for rel_path in FILES_TO_UPLOAD:
    local_path = os.path.join(BASE_DIR, rel_path.replace("/", os.sep))
    if not os.path.exists(local_path):
        print(f"  ⚠  SKIP (not found): {rel_path}")
        continue
    try:
        api.upload_file(
            path_or_fileobj=local_path,
            path_in_repo=rel_path,
            repo_id=REPO_ID,
            repo_type=REPO_TYPE,
            commit_message=f"deploy: update {rel_path.split('/')[-1]}",
        )
        print(f"  ✅ {rel_path}")
        success += 1
    except Exception as e:
        print(f"  ❌ FAILED {rel_path}: {e}")
        failed.append(rel_path)

print(f"\n{'='*50}")
print(f"Done: {success} uploaded, {len(failed)} failed.")
if failed:
    print("Failed files:")
    for f in failed:
        print(f"  - {f}")
