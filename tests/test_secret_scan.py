import base64
import json
import unittest

from scripts.check_secrets import find_credentials


def jwt(role):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    return ".".join((encode({"alg": "HS256"}), encode({"role": role}), "fake-signature"))


class SecretScanTests(unittest.TestCase):
    def test_detects_privileged_jwt_without_returning_the_token(self):
        token = jwt("service_role")
        result = find_credentials("# diagnostic\nkey = '" + token + "'")
        self.assertEqual(result, [(2, "Supabase service-role JWT")])
        self.assertNotIn(token, repr(result))

    def test_allows_public_anon_keys_and_environment_references(self):
        self.assertEqual(find_credentials(jwt("anon")), [])
        self.assertEqual(find_credentials('key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]'), [])

    def test_detects_provider_token_and_ignores_placeholder(self):
        self.assertEqual(find_credentials("hf_" + "a" * 30), [(1, "Hugging Face token")])
        self.assertEqual(find_credentials("hf_your_token_here"), [])

    def test_malformed_jwt_does_not_crash(self):
        self.assertEqual(find_credentials("eyJinvalid.invalid.invalid"), [])


if __name__ == "__main__":
    unittest.main()
