import unittest
from decimal import Decimal
import hashlib
import hmac
from unittest.mock import MagicMock, patch

from api.easykash_payments import _direct_pay_payload, _hosted_checkout_url, _verify_callback, create_checkout


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

    def test_hosted_checkout_defers_method_selection_to_easykash(self):
        payload = _direct_pay_payload(
            Decimal("200.00"),
            "Test User",
            "test@example.com",
            "01012345678",
            "https://egxbots.com/pricing",
            "test-order",
        )

        self.assertNotIn("paymentOptions", payload)
        self.assertNotIn("paymentOptionsExcluded", payload)
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
        self.assertNotIn("paymentOptions", request.call_args_list[0].kwargs["json"])

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


if __name__ == "__main__":
    unittest.main()
