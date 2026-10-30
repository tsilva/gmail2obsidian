"""Credential-free tests of request boundaries and local receipts."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.request

spec = importlib.util.spec_from_file_location("webhook_client", Path(__file__).parents[1] / "scripts/webhook_client.py")
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class WebhookClientTests(unittest.TestCase):
    def test_only_exact_deployment_urls_are_accepted(self):
        url = "https://script.google.com/macros/s/test-deployment/exec"
        self.assertEqual(client.validate_url(url), url)
        for bad in [url + "?token=anything", url + "#x", url + "/more", url.replace("https:", "http:"),
                    url.replace("script.google.com", "script.google.com.attacker.test"),
                    url.replace("script.google.com", "user@script.google.com")]:
            with self.assertRaises(ValueError):
                client.validate_url(bad)

    def test_only_the_placeholder_and_native_proxy_environment_are_accepted(self):
        good = {"WEBHOOK_PROXY_TOKEN": client.PLACEHOLDER, "HTTPS_PROXY": "http://127.0.0.1:1234",
                "SSL_CERT_FILE": "/test/ca.pem"}
        with patch.dict(os.environ, good, clear=True):
            client.require_proxy()
        for change in [{"WEBHOOK_PROXY_TOKEN": "ab" * 32}, {"HTTPS_PROXY": "http://remote.test:1234"},
                       {"NO_PROXY": "*"}, {"SSL_CERT_FILE": ""}]:
            with patch.dict(os.environ, {**good, **change}, clear=True), self.assertRaises(ValueError):
                client.require_proxy()

    def test_response_redirect_drops_the_post_body_and_all_request_headers(self):
        handler = client.ResponseRedirect()
        request = urllib.request.Request("https://script.google.com/macros/s/id/exec", data=b'private-body',
                                         headers={"Authorization": "private-header"}, method="POST")
        redirected = handler.redirect_request(request, None, 302, "", {},
                                              "https://script.googleusercontent.com/macros/echo?response=opaque")
        self.assertEqual(redirected.get_method(), "GET")
        self.assertIsNone(redirected.data)
        self.assertIsNone(redirected.get_header("Authorization"))
        with self.assertRaises(ValueError):
            handler.redirect_request(redirected, None, 302, "", {}, redirected.full_url)

    def test_redirects_to_other_hosts_and_credential_preserving_redirects_are_rejected(self):
        for code, url in [(302, "https://attacker.test/macros/echo"),
                          (307, "https://script.googleusercontent.com/macros/echo"),
                          (302, "http://script.googleusercontent.com/macros/echo"),
                          (302, "https://script.googleusercontent.com/other")]:
            with self.assertRaises(ValueError):
                client.ResponseRedirect().redirect_request(None, None, code, "", {}, url)

    def test_private_response_fields_never_leave_the_client(self):
        data = {"ok": True, "status": "authenticated", "subjects": ["private"], "token": "private"}
        self.assertEqual(client.clean_result(data, "check"), {"ok": True, "status": "authenticated"})
        for invalid in [{"ok": True, "status": "complete", "imported": 1, "errors": 1, "warnings": 0},
                        {"ok": True, "status": "complete", "imported": True, "errors": 0, "warnings": 0},
                        {"ok": True, "status": "unknown"}]:
            with self.assertRaises(ValueError):
                client.clean_result(invalid, "flush")

    def test_receipt_creation_is_exclusive_private_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            client.write_receipt(path, {"outcome": "pending"}, create=True)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                client.write_receipt(path, {}, create=True)
            client.write_receipt(path, {"outcome": "returned"})
            self.assertEqual(json.loads(path.read_text())["outcome"], "returned")
            link = Path(directory) / "link.json"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                client.write_receipt(link, {})


if __name__ == "__main__":
    unittest.main()
