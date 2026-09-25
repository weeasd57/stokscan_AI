import unittest
from decimal import Decimal
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from unittest.mock import MagicMock, patch

from api.easykash_payments import _direct_pay_payload, _hosted_checkout_url, _verify_callback, create_checkout, payment_config
from api.payment_common import plan_amount_egp, pro_discount, pro_regular_amount_egp


class EasyKashPayloadTests(unittest.TestCase):
    def test_hosted_url_is_canonicalized_and_strictly_validated(self):
        self.assertEqual(
            _hosted_checkout_url("https://easykash.net//DirectPayV1/ZVW5119"),
            "https://www.easykash.net/DirectPayV1/ZVW5119",
        )
        self.assertEqual(
            _hosted_checkout_url("https://www.easykash.net/DirectPayV1/ZVW5119"),
            "https://www.easykash.net/DirectPayV1/ZVW5119",
        )
        for invalid in (
            "https://easykash.net.evil.com/DirectPayV1/ZVW5119",
            "https://easykash.net@evil.com/DirectPayV1/ZVW5119",
            "http://easykash.net/DirectPayV1/ZVW5119",
            "https://www.easykash.net/login",
        ):
            with self.subTest(url=invalid), self.assertRaises(RuntimeError):
                _hosted_checkout_url(invalid)

    def test_hosted_checkout_defers_method_selection_and_excludes_installments(self):
        payload = _direct_pay_payload(
            Decimal("200.00"),
            "Test User",
            "test@example.com",
            "01012345678",
            "https://egxbots.com/pricing",
            "test-order",
        )

        self.assertNotIn("paymentOptions", payload)
        self.assertEqual(
            payload["paymentOptionsExcluded"],
            [3, 8, 9, 10, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 32, 33, 34],
        )
        for allowed_option in (1, 2, 4, 5, 6, 31, 35):
            self.assertNotIn(allowed_option, payload["paymentOptionsExcluded"])
        self.assertEqual(payload["currency"], "EGP")
        self.assertEqual(payload["amount"], 200.0)
        self.assertEqual(payload["customerReference"], "test-order")

    def test_checkout_lets_easykash_show_enabled_methods(self):
        database = MagicMock()
        database.table.return_value.insert.return_value.execute.return_value.data = [{"id": "test-order"}]
        provider = MagicMock()
        provider.status_code = 200
        provider.json.return_value = {"redirectUrl": "https://easykash.net/DirectPayV1/test"}
        with (
            patch("api.easykash_payments.is_payments_enabled", return_value=True),
            patch("api.easykash_payments.is_easykash_ready", return_value=True),
            patch("api.easykash_payments.plan_amount_egp", return_value=Decimal("200.00")),
            patch("api.easykash_payments._init_supabase"),
            patch("api.easykash_payments.supabase", database),
            patch("api.easykash_payments.requests.post", return_value=provider) as request,
            patch.dict("os.environ", {"EASYKASH_API_KEY": "test-key"}, clear=False),
        ):
            result = create_checkout("test-user", "pro", "test@example.com", "Test User", "01012345678")

        self.assertEqual(result["status"], "pending")
        self.assertEqual(result["url"], "https://www.easykash.net/DirectPayV1/test")
        # The checkout call is sent before the optional admin notification,
        # which can issue a second HTTP POST in the same test.
        sent_payload = request.call_args_list[0].kwargs["json"]
        self.assertNotIn("paymentOptions", sent_payload)
        self.assertEqual(
            sent_payload["paymentOptionsExcluded"],
            [3, 8, 9, 10, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 32, 33, 34],
        )

    def test_callback_signature_uses_easykash_documented_field_order(self):
        secret = "unit-test-secret"
        payload = {
            "ProductCode": "TEST123",
            "Amount": "50.5",
            "ProductType": "Subscription",
            "PaymentMethod": "Credit & Debit Card",
            "status": "PAID",
            "easykashRef": "EK123",
            "customerReference": "customer-123",
        }
        signed_values = (
            payload["ProductCode"],
            payload["Amount"],
            payload["ProductType"],
            payload["PaymentMethod"],
            payload["status"],
            payload["easykashRef"],
            payload["customerReference"],
        )
        message = "".join(signed_values).encode("utf-8")
        payload["signatureHash"] = hmac.new(secret.encode(), message, hashlib.sha512).hexdigest()

        with patch.dict("os.environ", {"EASYKASH_CALLBACK_SECRET": secret}, clear=False):
            self.assertTrue(_verify_callback(payload))
            altered = {**payload, "Amount": "50.6"}
            self.assertFalse(_verify_callback(altered))


class ProDiscountTests(unittest.TestCase):
    FUTURE = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat().replace("+00:00", "Z")
    PAST = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")

    def test_env_discount_active_applies_to_monthly_only(self):
        with (
            patch("api.payment_common.billing_settings", return_value={}),
            patch.dict(
                "os.environ",
                {
                    "PRO_DISCOUNT_PRICE_EGP": "50",
                    "PRO_DISCOUNT_ENDS_AT": self.FUTURE,
                    "PRO_PRICE_EGP": "200",
                    "PRO_6M_PRICE_EGP": "1000",
                    "PRO_1Y_PRICE_EGP": "1800",
                },
                clear=False,
            ),
        ):
            discount = pro_discount()
            self.assertTrue(discount["active"])
            self.assertEqual(discount["price_egp"], 50.0)
            self.assertEqual(plan_amount_egp("pro"), 50.0)
            self.assertEqual(plan_amount_egp("pro_6m"), 1000.0)
            self.assertEqual(plan_amount_egp("pro_1y"), 1800.0)
            self.assertEqual(pro_regular_amount_egp(), 200.0)

    def test_expired_discount_falls_back_to_base_price(self):
        with (
            patch("api.payment_common.billing_settings", return_value={}),
            patch.dict(
                "os.environ",
                {"PRO_DISCOUNT_PRICE_EGP": "50", "PRO_DISCOUNT_ENDS_AT": self.PAST, "PRO_PRICE_EGP": "200"},
                clear=False,
            ),
        ):
            self.assertFalse(pro_discount()["active"])
            self.assertEqual(plan_amount_egp("pro"), 200.0)

    def test_admin_settings_discount_takes_precedence_over_env(self):
        settings = {
            "discount_enabled": True,
            "discount_price_egp": 75,
            "discount_ends_at": self.FUTURE,
            "pro_price_egp": 250,
        }
        with (
            patch("api.payment_common.billing_settings", return_value=settings),
            patch.dict("os.environ", {"PRO_PRICE_EGP": "200"}, clear=False),
        ):
            self.assertEqual(pro_discount()["price_egp"], 75.0)
            self.assertEqual(plan_amount_egp("pro"), 75.0)
            self.assertEqual(pro_regular_amount_egp(), 250.0)

    def test_admin_disabled_flag_blocks_env_discount(self):
        with (
            patch("api.payment_common.billing_settings", return_value={"discount_enabled": False}),
            patch.dict(
                "os.environ",
                {"PRO_DISCOUNT_PRICE_EGP": "50", "PRO_DISCOUNT_ENDS_AT": self.FUTURE, "PRO_PRICE_EGP": "200"},
                clear=False,
            ),
        ):
            self.assertFalse(pro_discount()["active"])
            self.assertEqual(plan_amount_egp("pro"), 200.0)


class PaymentConfigTests(unittest.TestCase):
    def test_config_exposes_discount_and_has_no_test_plan(self):
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat().replace("+00:00", "Z")
        with (
            patch("api.payment_common.billing_settings", return_value={}),
            patch("api.easykash_payments.is_payments_enabled", return_value=True),
            patch("api.easykash_payments.is_easykash_ready", return_value=True),
            patch.dict(
                "os.environ",
                {
                    "PRO_DISCOUNT_PRICE_EGP": "50",
                    "PRO_DISCOUNT_ENDS_AT": future,
                    "PRO_PRICE_EGP": "200",
                    "PRO_6M_PRICE_EGP": "1000",
                    "PRO_1Y_PRICE_EGP": "1800",
                },
                clear=False,
            ),
        ):
            config = payment_config()
        plan_ids = [plan["id"] for plan in config["plans"]]
        self.assertEqual(plan_ids, ["pro", "pro_6m", "pro_1y"])
        self.assertNotIn("pro_test", plan_ids)
        monthly = config["plans"][0]
        self.assertEqual(monthly["amount_egp"], 50)
        self.assertTrue(monthly["discount"]["active"])
        self.assertEqual(monthly["discount"]["original_amount_egp"], 200)
        self.assertEqual(config["plans"][1]["amount_egp"], 1000)


if __name__ == "__main__":
    unittest.main()
