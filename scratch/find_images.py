import os
import glob

brain_dir = r"C:\Users\MR__CODER__\.gemini\antigravity\brain"
images = glob.glob(os.path.join(brain_dir, "**", "*.png"), recursive=True) + \
         glob.glob(os.path.join(brain_dir, "**", "*.jpg"), recursive=True)

print(f"Found {len(images)} images in brain directory:")
for img in sorted(images, key=os.path.getmtime, reverse=True)[:10]:
    print(f" - {img} ({os.path.getsize(img)} bytes) modified: {os.path.getmtime(img)}")
