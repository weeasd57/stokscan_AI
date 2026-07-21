import urllib.request
import json
import ssl

ssl_context = ssl._create_unverified_context()

def test_chat():
    url = "http://127.0.0.1:3000/api/ai-chat"
    payload = {
        "message": "ما هو أفضل سهم في البورصة المصرية اليوم ولماذا؟",
        "model": "z-ai/glm-5.2"
    }
    headers = {
        "Content-Type": "application/json"
    }
    
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    
    try:
        print("Sending test message to local AI chat endpoint...")
        with urllib.request.urlopen(req, context=ssl_context, timeout=20) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            print("\n--- Response Status Code: 200 OK ---")
            print("Reply from AI:\n", data.get("reply"))
            print("\nSession ID:", data.get("session_id"))
            print("Remaining Quota:", data.get("remaining_quota"))
    except Exception as e:
        print("HTTP Error / Exception:", e)
        if hasattr(e, "read"):
            print("Error details:", e.read().decode("utf-8"))

if __name__ == "__main__":
    test_chat()
