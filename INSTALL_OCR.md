# تثبيت OCR للصور (اختياري لكن مهم للدقة)

## المشكلة
Llama Vision ضعيف في قراءة النصوص العربية

## الحل
إضافة Tesseract OCR (مجاني ودقيق)

---

## التثبيت على Windows 🪟

### 1. تثبيت Tesseract:
قم بتنزيل المثبت من:
https://github.com/UB-Mannheim/tesseract/wiki

أو استخدم Chocolatey:
```bash
choco install tesseract
```

### 2. تثبيت Python packages:
```bash
cd web
pip install -r requirements.txt
```

### 3. تحقق من التثبيت:
```bash
tesseract --version
python ocr_helper.py
```

---

## التثبيت على Linux 🐧

```bash
# تثبيت Tesseract مع دعم العربية
sudo apt-get update
sudo apt-get install tesseract-ocr tesseract-ocr-ara

# تثبيت Python packages
cd web
pip install -r requirements.txt
```

---

## التثبيت على Mac 🍎

```bash
# تثبيت Tesseract
brew install tesseract tesseract-lang

# تثبيت Python packages
cd web
pip install -r requirements.txt
```

---

## التحقق من التثبيت ✅

```bash
# تحقق من Tesseract
tesseract --version

# يجب أن ترى:
# tesseract 5.x.x
# leptonica-x.x.x

# تحقق من اللغة العربية
tesseract --list-langs

# يجب أن ترى:
# ara (Arabic)
# eng (English)
```

---

## كيفية الاستخدام 🚀

بعد التثبيت:
1. شغّل السيرفر: `npm run dev`
2. ارفع صورة محفظة
3. ✅ **OCR preprocessing سيعمل تلقائياً**
4. الشات بوت هيستخدم النصوص المستخرجة لتحسين الدقة

---

## إذا لم تقم بالتثبيت ⚠️

الشات بوت سيعمل **بدون OCR**، لكن:
- ❌ دقة أقل في قراءة النصوص العربية
- ❌ قد يخلط بين الأرقام
- ✅ لكن سيحاول باستخدام Vision Model فقط

---

## Troubleshooting 🔧

### مشكلة: "tesseract: command not found"
**الحل:** أضف Tesseract لـ PATH:
- Windows: `C:\Program Files\Tesseract-OCR`
- Linux/Mac: `/usr/bin/tesseract`

### مشكلة: "Language 'ara' not found"
**الحل:** 
```bash
# Linux
sudo apt-get install tesseract-ocr-ara

# Mac
brew install tesseract-lang

# Windows
# أعد تثبيت Tesseract واختر "Additional language data" في المثبت
```

### مشكلة: Python script fails
**الحل:**
```bash
# تأكد من Python 3.8+
python --version

# أعد تثبيت packages
pip install --force-reinstall pytesseract Pillow
```

---

## البدائل (إذا فشل Tesseract)

### Option 1: استخدام Cloud OCR APIs
- Google Vision API (مدفوع)
- Azure Computer Vision (مدفوع)
- AWS Textract (مدفوع)

### Option 2: قبول الدقة الأقل
- استمر بدون OCR
- اطلب من المستخدمين كتابة رموز الأسهم يدوياً

---

**ملاحظة:** التثبيت اختياري لكن **مُوصى به بشدة** لتحسين دقة قراءة الصور!
