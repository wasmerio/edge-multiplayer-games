import base64
import json
import re
import urllib.error
import urllib.request

LIMIT = 8 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(url, token, data=None, method=None, timeout=30):
    headers = {"Accept": "application/json", "Content-Type": "application/json",
               "User-Agent": "wasmer-daily-game"}
    if url.startswith("https://api.github.com/"):
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    req = urllib.request.Request(url, headers=headers, method=method,
                                 data=None if data is None else json.dumps(data).encode())
    req.add_unredirected_header("Authorization", "Bearer " + token)
    with urllib.request.build_opener(NoRedirect).open(req, timeout=timeout) as response:
        raw = response.read(LIMIT + 1)
    require(len(raw) <= LIMIT, "API response exceeds size limit")
    return json.loads(raw) if raw else None


class GitHub:
    def __init__(self, repository, token):
        require(re.fullmatch(r"[\w.-]+/[\w.-]+", repository), "Invalid repository")
        require(bool(token), "GITHUB_TOKEN secret is missing")
        self.root = "https://api.github.com/repos/" + repository
        self.token = token

    def request(self, path, data=None, method=None):
        return request_json(self.root + path, self.token, data, method)

    def file(self, path, ref):
        try:
            result = self.request("/contents/" + path + "?ref=" + ref)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                error.close()
                return None
            raise
        require(result.get("encoding") == "base64", "Unsupported repository file encoding")
        return base64.b64decode(result["content"]).decode("utf-8")
