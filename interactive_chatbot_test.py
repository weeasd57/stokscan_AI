#!/usr/bin/env python3
"""
Interactive Chatbot Test
Simulates real chat conversation with intent detection and response generation.
"""

import sys
from pathlib import Path
from typing import Dict, List
sys.path.insert(0, str(Path(__file__).parent / "api"))

from api.chatbot_tools import parse_user_intent, ChatbotTools
from api.opportunity_analyzer import OpportunityAnalyzer
from api.routers.chatbot import generate_response_from_intent

# Mock stock data
MOCK_STOCKS = {
    "FERC": {
        "symbol": "FERC",
        "close_price": 1.24,
        "rsi": 42.5,
        "macd": 0.0089,
        "volume_ratio": 0.53,
        "accumulation_score": 45.2,
        "distribution_score": 0,
        "support": 1.10,
        "resistance": 1.35,
        "date": "2026-08-08"
    },
    "SAOG": {  # المطاحن
        "symbol": "SAOG",
        "close_price": 30.50,
        "rsi": 52.1,
        "macd": 0.042,
        "volume_ratio": 1.21,
        "accumulation_score": 62.3,
        "distribution_score": 0,
        "support": 28.0,
        "resistance": 33.0,
        "date": "2026-08-08"
    },
    "ALEX": {  # الاسكندريه
        "symbol": "ALEX",
        "close_price": 119.50,
        "rsi": 48.9,
        "macd": 0.053,
        "volume_ratio": 0.89,
        "accumulation_score": 58.1,
        "distribution_score": 0,
        "support": 110.0,
        "resistance": 130.0,
        "date": "2026-08-08"
    },
    "RAYA": {
        "symbol": "RAYA",
        "close_price": 7.80,
        "rsi": 35.2,
        "macd": -0.0045,
        "volume_ratio": 0.67,
        "accumulation_score": 38.9,
        "distribution_score": 12.5,
        "support": 7.20,
        "resistance": 8.50,
        "date": "2026-08-08"
    },
    "NILE": {  # النيل
        "symbol": "NILE",
        "close_price": 2.98,
        "rsi": 55.3,
        "macd": 0.0067,
        "volume_ratio": 1.45,
        "accumulation_score": 72.1,
        "distribution_score": 0,
        "support": 2.70,
        "resistance": 3.30,
        "date": "2026-08-08"
    },
    "CPME": {
        "symbol": "CPME",
        "close_price": 12.50,
        "rsi": 45.2,
        "macd": 0.0821,
        "volume_ratio": 2.52,
        "accumulation_score": 80.3,
        "distribution_score": 0,
        "support": 10.50,
        "resistance": 14.00,
        "date": "2026-08-08"
    }
}


class InteractiveChatbot:
    """Interactive chatbot for testing."""
    
    def __init__(self):
        self.analyzer = OpportunityAnalyzer()
        self.conversation_history = []
    
    def process_message(self, user_message: str) -> Dict:
        """Process user message and return response."""
        
        # Step 1: Parse Intent
        intent = parse_user_intent(user_message)
        
        # Step 2: Generate Response
        response = self._generate_response(intent, user_message)
        
        # Store in history
        self.conversation_history.append({
            "role": "user",
            "message": user_message,
            "intent": intent
        })
        self.conversation_history.append({
            "role": "assistant",
            "message": response
        })
        
        return {
            "intent": intent,
            "response": response,
            "intent_type": intent.get("intent"),
            "confidence": self._calculate_confidence(intent)
        }
    
    def _generate_response(self, intent: Dict, user_message: str) -> str:
        """Generate appropriate response based on intent."""
        intent_type = intent.get("intent")
        
        if intent_type == "stock_analysis":
            return self._handle_stock_analysis(intent)
        
        elif intent_type == "comparison":
            return self._handle_comparison(intent)
        
        elif intent_type == "sell_decision":
            return self._handle_sell_decision(intent)
        
        elif intent_type == "portfolio_analysis":
            return self._handle_portfolio_analysis(intent)
        
        elif intent_type == "screening":
            return self._handle_screening(intent)
        
        elif intent_type == "market_overview":
            return self._handle_market_overview()
        
        else:
            return self._handle_general(user_message)
    
    def _handle_stock_analysis(self, intent: Dict) -> str:
        """Handle single stock analysis."""
        ticker = intent.get("ticker")
        stock_data = MOCK_STOCKS.get(ticker)
        
        if not stock_data:
            return f"❌ للأسف، لا توجد بيانات لسهم {ticker} حالياً."
        
        analysis = self.analyzer.calculate_weekly_opportunity_score(stock_data)
        
        lines = [
            f"📊 **تحليل سهم {ticker}**",
            f"",
            f"**التقييم:** {analysis['recommendation']} (نقاط الفرصة: {analysis['score']:.0f})",
            f"",
            f"**البيانات الفنية:**",
            f"• السعر: {stock_data['close_price']:.2f} جنيه",
            f"• RSI: {stock_data['rsi']:.1f}",
            f"• MACD: {stock_data['macd']:.4f}",
            f"• نسبة الحجم: {stock_data['volume_ratio']:.2f}x",
            f"• التجميع: {stock_data['accumulation_score']:.1f}",
            f"• الدعم: {stock_data['support']:.2f} | المقاومة: {stock_data['resistance']:.2f}",
        ]
        
        if analysis["reasons"]:
            lines.append("")
            lines.append("✅ **الأسباب الإيجابية:**")
            for reason in analysis["reasons"]:
                lines.append(f"  - {reason}")
        
        if analysis["risks"]:
            lines.append("")
            lines.append("⚠️ **المخاطر:**")
            for risk in analysis["risks"]:
                lines.append(f"  - {risk}")
        
        return "\n".join(lines)
    
    def _handle_comparison(self, intent: Dict) -> str:
        """Handle stock comparison."""
        tickers = intent.get("tickers", [])
        
        lines = [f"📊 **مقارنة الأسهم**", f""]
        
        analyses = []
        for ticker in tickers:
            stock_data = MOCK_STOCKS.get(ticker)
            if stock_data:
                analysis = self.analyzer.calculate_weekly_opportunity_score(stock_data)
                analyses.append((ticker, analysis, stock_data))
        
        # Sort by score
        analyses.sort(key=lambda x: x[1]["score"], reverse=True)
        
        for idx, (ticker, analysis, stock_data) in enumerate(analyses, 1):
            lines.append(f"**{idx}. {ticker}** — {analysis['recommendation']} (نقاط: {analysis['score']:.0f})")
            lines.append(f"   • السعر: {stock_data['close_price']:.2f} جنيه")
            lines.append(f"   • RSI: {stock_data['rsi']:.1f}")
            lines.append(f"   • الحجم: {stock_data['volume_ratio']:.2f}x")
            lines.append(f"   • التجميع: {stock_data['accumulation_score']:.1f}")
            lines.append("")
        
        if len(analyses) > 1:
            best = analyses[0]
            lines.append(f"🏆 **الأفضل:** {best[0]} بنقاط {best[1]['score']:.0f}")
        
        return "\n".join(lines)
    
    def _handle_sell_decision(self, intent: Dict) -> str:
        """Handle sell decision."""
        tickers = intent.get("tickers", [])
        entry_prices = intent.get("entry_prices", [])
        
        if not tickers:
            return "❌ لم أستطع تحديد السهم. يرجى ذكر اسم السهم."
        
        ticker = tickers[0]
        entry_price = entry_prices[0] if entry_prices else None
        stock_data = MOCK_STOCKS.get(ticker)
        
        if not stock_data:
            return f"❌ لا توجد بيانات لسهم {ticker}."
        
        if not entry_price:
            return f"⚠️ لم أتمكن من استخراج سعر الشراء. يرجى ذكره بوضوح."
        
        analysis = self.analyzer.calculate_weekly_opportunity_score(stock_data)
        current_price = stock_data['close_price']
        change_pct = ((current_price - entry_price) / entry_price) * 100
        change_amount = current_price - entry_price
        
        lines = [
            f"💰 **قرار البيع لـ {ticker}**",
            f"",
            f"**الحالة المالية:**",
            f"• سعر الشراء: {entry_price:.2f} جنيه",
            f"• السعر الحالي: {current_price:.2f} جنيه",
            f"• التغير: {change_pct:+.2f}% ({change_amount:+.2f} جنيه)",
            f"",
            f"**التحليل الفني:**",
            f"• التقييم: {analysis['recommendation']}",
            f"• نقاط الفرصة: {analysis['score']:.0f}/100",
            f"• RSI: {stock_data['rsi']:.1f}",
            f"• MACD: {stock_data['macd']:.4f}",
        ]
        
        # Recommendation
        if change_pct < -10:
            if analysis["score"] < 40:
                lines.append("")
                lines.append("🚨 **التوصية:** بيع الآن (خسائر كبيرة + ضعف فني)")
            else:
                lines.append("")
                lines.append("⚠️ **التوصية:** انتظر قليلاً (قد يكون تصحيح)")
        
        elif change_pct < -5:
            lines.append("")
            lines.append("⚠️ **التوصية:** مراقبة (خسائر محدودة)")
        
        elif change_pct > 10 and analysis["score"] > 70:
            lines.append("")
            lines.append("✅ **التوصية:** احتفظ (أرباح قوية + مؤشرات إيجابية)")
        
        else:
            lines.append("")
            lines.append("ℹ️ **التوصية:** انتظر تأكيد إضافي")
        
        return "\n".join(lines)
    
    def _handle_portfolio_analysis(self, intent: Dict) -> str:
        """Handle portfolio analysis."""
        return ("📋 **تحليل المحفظة**\n\n"
                "لتحليل محفظتك، يرجى إخبارني بالأسهم التي تمتلكها.\n\n"
                "مثال:\n"
                "- 'محفظتي فيها CPME و MOIN و RAYA'\n"
                "- 'حلل الأسهم: FERC, NILE, ALEX'\n\n"
                "بعدها سأقدم لك تحليل شامل 📊")
    
    def _handle_screening(self, intent: Dict) -> str:
        """Handle screening requests."""
        criteria = intent.get("criteria")
        
        # For demo, return all stocks sorted by score
        lines = [f"📊 **أفضل الفرص المتاحة**", f""]
        
        analyses = []
        for ticker, stock_data in MOCK_STOCKS.items():
            analysis = self.analyzer.calculate_weekly_opportunity_score(stock_data)
            analyses.append((ticker, analysis, stock_data))
        
        # Sort by score
        analyses.sort(key=lambda x: x[1]["score"], reverse=True)
        
        for idx, (ticker, analysis, stock_data) in enumerate(analyses[:5], 1):
            lines.append(f"**{idx}. {ticker}** — {analysis['recommendation']} ({analysis['score']:.0f} نقاط)")
            lines.append(f"   • السعر: {stock_data['close_price']:.2f}")
            lines.append(f"   • التجميع: {stock_data['accumulation_score']:.0f}")
            lines.append("")
        
        return "\n".join(lines)
    
    def _handle_market_overview(self) -> str:
        """Handle market overview."""
        return ("📈 **المؤشرات السوقية**\n\n"
                "• **مؤشر EGX30:** 53,931.9 نقطة\n"
                "  (آخر تحديث: 2026-08-08)\n\n"
                "• **سعر الدولار:** 51.25 جنيه\n"
                "  (آخر تحديث: 2026-08-08)")
    
    def _handle_general(self, user_message: str) -> str:
        """Handle general messages."""
        return ("ℹ️ **شكراً على السؤال!**\n\n"
                "أستطيع مساعدتك في:\n"
                "✓ تحليل أسهم معينة\n"
                "✓ مقارنة عدة أسهم\n"
                "✓ قرارات البيع والشراء\n"
                "✓ تحليل المحفظة\n"
                "✓ أفضل الفرص\n\n"
                "يرجى إعادة الصياغة أو تحديد ما تريد بالضبط 😊")
    
    def _calculate_confidence(self, intent: Dict) -> float:
        """Calculate confidence level of intent detection."""
        intent_type = intent.get("intent")
        
        # Base confidence
        confidence_map = {
            "stock_analysis": 0.95,
            "comparison": 0.93,
            "sell_decision": 0.92,
            "portfolio_analysis": 0.90,
            "screening": 0.88,
            "market_overview": 0.95,
            "general": 0.50
        }
        
        return confidence_map.get(intent_type, 0.5)
    
    def print_state(self):
        """Print conversation state."""
        print(f"\n📜 **سجل المحادثة** ({len(self.conversation_history)//2} رسائل)")
        for entry in self.conversation_history[-4:]:  # Last 2 exchanges
            if entry["role"] == "user":
                print(f"\n👤 أنت: {entry['message']}")
                print(f"   📍 Intent: {entry.get('intent', {}).get('intent')}")
            else:
                print(f"\n🤖 البوت: {entry['message'][:100]}...")


def run_interactive_session():
    """Run interactive chat session."""
    chatbot = InteractiveChatbot()
    
    print("\n" + "="*80)
    print("🤖 INTERACTIVE CHATBOT TEST")
    print("="*80)
    print("\nاختبر الشات بأسئلة مختلفة. اكتب 'exit' للخروج")
    print("Commands: 'history' = سجل المحادثة | 'stats' = الإحصائيات\n")
    
    while True:
        try:
            user_input = input("\n👤 أنت: ").strip()
            
            if not user_input:
                continue
            
            if user_input.lower() == "exit":
                print("\n👋 شكراً لاستخدام البوت!")
                break
            
            if user_input.lower() == "history":
                chatbot.print_state()
                continue
            
            if user_input.lower() == "stats":
                print(f"\n📊 الإحصائيات:")
                print(f"   - عدد الرسائل: {len(chatbot.conversation_history)//2}")
                intent_counts = {}
                for entry in chatbot.conversation_history:
                    if entry["role"] == "user":
                        intent = entry.get("intent", {}).get("intent", "unknown")
                        intent_counts[intent] = intent_counts.get(intent, 0) + 1
                
                for intent, count in sorted(intent_counts.items()):
                    print(f"   - {intent}: {count}")
                continue
            
            # Process message
            result = chatbot.process_message(user_input)
            
            # Print response
            print(f"\n📊 Intent Detected: {result['intent_type']} ({result['confidence']:.0%} confidence)")
            print(f"\n🤖 البوت:\n{result['response']}")
        
        except KeyboardInterrupt:
            print("\n\n👋 تم إيقاف البوت.")
            break
        except Exception as e:
            print(f"\n❌ خطأ: {e}")
            continue


if __name__ == "__main__":
    run_interactive_session()
