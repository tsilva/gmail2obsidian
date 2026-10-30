"""Fixed import client for the native Infisical sandbox; never loads a real key."""

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import sys
import time
import urllib.parse
import urllib.request

PLACEHOLDER = "gmail2obsidian_proxy_placeholder"


def validate_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.netloc != "script.google.com"
            or parsed.query or parsed.fragment
            or not re.fullmatch(r"/macros/s/[A-Za-z0-9_-]+/exec", parsed.path)):
        raise ValueError("Expected an exact Google Apps Script deployment URL")
    return url


def load_config(path):
    data = json.loads(Path(path).read_text())
    if (not isinstance(data, dict) or set(data) != {"version", "webhook_url", "receipt_directory"}
            or type(data["version"]) is not int or data["version"] != 1
            or not isinstance(data["webhook_url"], str)
            or not isinstance(data["receipt_directory"], str)):
        raise ValueError("Invalid private webhook configuration")
    validate_url(data["webhook_url"])
    directory = Path(data["receipt_directory"])
    if not directory.is_absolute() or directory.resolve() != directory:
        raise ValueError("Receipt directory must be absolute and have no symlink components")
    return data


def require_proxy():
    if os.environ.get("WEBHOOK_PROXY_TOKEN") != PLACEHOLDER:
        raise ValueError("Required Infisical placeholder missing; no credential fallback")
    proxy = urllib.parse.urlsplit(os.environ.get("HTTPS_PROXY", ""))
    if (proxy.scheme != "http" or proxy.hostname != "127.0.0.1" or not proxy.port
            or proxy.username or proxy.password or proxy.query or proxy.fragment
            or proxy.path not in ("", "/") or not os.environ.get("SSL_CERT_FILE")
            or os.environ.get("NO_PROXY") or os.environ.get("no_proxy")):
        raise ValueError("Expected native proxy, local CA, and no proxy bypass")


class ResponseRedirect(urllib.request.HTTPRedirectHandler):
    """Follow only Google's credential-free response fetch, never resend a POST."""

    def __init__(self):
        self.followed = False

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if (self.followed or code not in (302, 303)
                or parsed.scheme != "https" or parsed.netloc != "script.googleusercontent.com"
                or parsed.path != "/macros/echo" or parsed.fragment):
            raise ValueError("Unexpected webhook redirect")
        self.followed = True
        return urllib.request.Request(newurl, method="GET", headers={"Accept": "application/json"})


def clean_result(data, action):
    if not isinstance(data, dict) or type(data.get("ok")) is not bool:
        raise ValueError("Invalid webhook response")
    status = data.get("status")
    rejected = {"unauthorized", "busy", "already_used", "failed_or_unknown"}
    if status in rejected and data["ok"] is False:
        return {"ok": False, "status": status}
    if action == "check" and status == "authenticated" and data["ok"] is True:
        return {"ok": True, "status": status}
    if action != "flush" or status not in {"complete", "partial_failure", "more_may_remain"}:
        raise ValueError("Invalid webhook result")
    counts = {key: data.get(key) for key in ("imported", "errors", "warnings")}
    if any(type(value) is not int or value < 0 for value in counts.values()):
        raise ValueError("Invalid webhook counts")
    if data["ok"] != (status == "complete") or (status == "complete" and (counts["errors"] or counts["warnings"])):
        raise ValueError("Inconsistent webhook result")
    return {"ok": data["ok"], "status": status, **counts}


def post_webhook(url, request, action):
    require_proxy()
    context = ssl.create_default_context(cafile=os.environ["SSL_CERT_FILE"])
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": os.environ["HTTPS_PROXY"], "https": os.environ["HTTPS_PROXY"]}),
        urllib.request.HTTPSHandler(context=context), ResponseRedirect())
    req = urllib.request.Request(url, data=json.dumps(request).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Accept": "application/json"})
    # One POST only. Unknown outcomes must not generate another request ID.
    with opener.open(req, timeout=30) as response:
        raw = response.read(8193)
        if len(raw) > 8192:
            raise ValueError("Oversized webhook response")
        return clean_result(json.loads(raw), action)


def write_receipt(path, data, *, create=False):
    flags = os.O_WRONLY | os.O_NOFOLLOW
    flags |= os.O_CREAT | os.O_EXCL if create else os.O_TRUNC
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(data, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "flush"))
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    try:
        require_proxy()
        config = load_config(args.config)
        directory = Path(config["receipt_directory"])
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        request = {"action": args.action, "timestamp": int(time.time()),
                   "requestId": secrets.token_hex(16), "token": PLACEHOLDER}
        receipt_path = directory / (request["requestId"] + ".json")
        receipt = {"version": 1, "action": args.action, "timestamp": request["timestamp"],
                   "request_id": request["requestId"], "outcome": "pending"}
        write_receipt(receipt_path, receipt, create=True)
        try:
            result = post_webhook(config["webhook_url"], request, args.action)
        except Exception:
            result = {"ok": False, "status": "failed_or_unknown"}
        receipt.update(outcome="returned" if result["status"] != "failed_or_unknown" else "unknown", result=result)
        write_receipt(receipt_path, receipt)
        print(json.dumps({**result, "receipt": str(receipt_path)}))
        return 0 if result["ok"] else 1
    except Exception:
        # Never echo an exception, upstream body, request body, token, or proxy URL.
        print(json.dumps({"ok": False, "status": "configuration_or_receipt_error"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
