import os
import json
import base64
import urllib.request
import urllib.parse
from dotenv import load_dotenv

load_dotenv()
load_dotenv("web/.env.local")

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
if not NVIDIA_API_KEY:
    # Try reading from Supabase route_data
    try:
        from supabase import create_client
        url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if url and key:
            sb = create_client(url, key)
            res = sb.from_("ai_chatbot_settings").select("api_key").single().execute()
            if res.data:
                NVIDIA_API_KEY = res.data.get("api_key", "")
    except Exception as e:
        print("Error reading key:", e)

print("NVIDIA_API_KEY found:", bool(NVIDIA_API_KEY))

# Test image: download user's portfolio image or use a base64 test image
img_path = r"C:\Users\MR__CODER__\.gemini\antigravity\brain\8b55cac5-1522-4f6a-b22a-85aa87c434c2\media__1784590869816.png"

if os.path.exists(img_path):
    with open(img_path, "rb") as f:
        img_b64 = "data:image/png;base64," + base64.b64encode(f.read()).decode("utf-8")
    print("Loaded image from artifacts, size:", len(img_b64))
else:
    print("Image not found at path:", img_path)
    exit(1)

promptText = """أنت محرك قراءة وتحليل الصور المالية للبورصة المصرية. 
اقرأ كافة النصوص والرموز والأرقام والأسعار الموجودة داخل هذه الصورة بوضوح ودقة عالية:

1. اذكر رمز/اسم كل سهم ظاهر في الصورة (مثل KRDI, GGCC, AIHC, AIDC).
2. اقرأ السعر المحدد بالأرقام بجانب كل سهم (مثل 253.34، 407.69، 19.20، 310.80).
3. اقرأ نسبة التغير والتفاصيل المكتوبة.
4. اذكر إجمالي قيمة المحفظة المكتوبة في الأعلى.
5. قدم ملخصاً تحليلياً شاملاً باللغة العربية بناءً على الأرقام الحقيقية الموضحة بالصورة."""

payload = {
    "model": "meta/llama-3.2-11b-vision-instruct",
    "messages": [
        {
            "role": "system",
            "content": "أنت خبير محترف ومحرك قراءة صور مالي (OCR Financial Analyst). مهمتك الوحيدة هي قراءة الأرقام الحقيقية المكتوبة داخل الصورة وتحليلها باللغة العربية بدقة متناهية دون تخمين."
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": promptText},
                {"type": "image_url", "image_url": {"url": img_b64}}
            ]
        }
    ],
    "temperature": 0.1,
    "max_tokens": 1024
}

req = urllib.request.Request(
    "https://integrate.api.nvidia.com/v1/chat/completions",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {NVIDIA_API_KEY}"
    }
)

try:
    with urllib.request.urlopen(req) as resp:
        res_data = json.loads(resp.read().decode("utf-8"))
        content = res_data["choices"][0]["message"]["content"]
        with open("scratch/vision_result.txt", "w", encoding="utf-8") as out_f:
            out_f.write(content)
        print("\n--- AI RESPONSE SAVED TO scratch/vision_result.txt ---")
except Exception as err:
    print("Error during test call:", err)
