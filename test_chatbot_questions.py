#!/usr/bin/env python
# -*- coding: utf-8 -*-
import os
import sys
from supabase import create_client

# تأكد من encoding صحيح
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

def get_recent_questions():
    url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    
    if not url or not key:
        print('❌ Supabase غير مكون')
        return []
    
    try:
        sb = create_client(url, key)
        res = sb.table('ai_chat_messages').select('content, created_at').eq('role', 'user').order('created_at', desc=True).limit(30).execute()
        
        if res.data:
            print(f'\n📊 آخر {len(res.data)} سؤال من المستخدمين:\n')
            questions = []
            for i, msg in enumerate(res.data, 1):
                content = msg.get('content', '')
                if content and len(content) > 3:
                    print(f'{i}. {content[:150]}')
                    questions.append(content)
            return questions
        else:
            print('❌ لا توجد بيانات')
            return []
    except Exception as e:
        print(f'❌ خطأ: {e}')
        return []

if __name__ == '__main__':
    questions = get_recent_questions()
    print(f'\n✅ تم جلب {len(questions)} سؤال')
