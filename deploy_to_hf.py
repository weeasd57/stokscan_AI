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
    # Python Backend
    "api/daily_bot_run.py",
    "api/daily_job_scheduler.py",
    "api/free_data_provider.py",
    "api/health.py",
    "api/main.py",
    "api/stock_ai.py",
    "api/symbols_local.py",
    "api/smart_sync.py",
    "api/tradingview_integration.py",
    "api/routers/bot.py",
    "api/upload_symbols.py",

    # Next.js API Routes
    "web/src/app/api/admin/support/chats/route.ts",
    "web/src/app/api/scan/news/route.ts",
    "web/src/app/api/admin/daily-jobs/history/route.ts",
    "web/src/app/api/admin/daily-jobs/schedule/route.ts",
    "web/src/app/api/market/status/route.ts",
    "web/src/app/api/market/macro-correlation/data/route.ts",
    "web/src/app/api/scan/sectors/heatmap/route.ts",
    "web/src/app/api/scan/sectors/timeline/route.ts",
    "web/src/app/api/symbols/inventory/route.ts",
    "web/src/app/api/support/message/route.ts",
    "web/src/app/api/support/messages/route.ts",
    "web/src/app/api/ai_bot/candles/route.ts",
    "web/src/app/api/ai_bot/telegram/bot_username/route.ts",
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
