#!/usr/bin/env python3
"""
OCR Helper using Tesseract for Arabic text extraction
Install: pip install pytesseract pillow
System: apt-get install tesseract-ocr tesseract-ocr-ara (Linux)
        brew install tesseract tesseract-lang (Mac)
"""

import sys
import json
import base64
from io import BytesIO
from PIL import Image
import pytesseract

def extract_text_from_base64(base64_string):
    """Extract text from base64 image using Tesseract OCR"""
    try:
        # Remove data:image/...;base64, prefix if present
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        
        # Decode base64 to image
        image_data = base64.b64decode(base64_string)
        image = Image.open(BytesIO(image_data))
        
        # Extract text using Tesseract (Arabic + English)
        text = pytesseract.image_to_string(image, lang='ara+eng')
        
        return {
            "success": True,
            "text": text.strip(),
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "text": "",
            "error": str(e)
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No image data provided"}))
        sys.exit(1)
    
    base64_image = sys.argv[1]
    result = extract_text_from_base64(base64_image)
    print(json.dumps(result, ensure_ascii=False))
