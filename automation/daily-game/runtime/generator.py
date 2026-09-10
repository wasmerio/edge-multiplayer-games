import json
from pathlib import Path
import re
import time

from github import request_json, require

FIELDS = ("name", "description", "readme", "game_js", "client_tail",
          "index_html", "style_css", "scenarios_js")
SCHEMA = {"type": "object", "additionalProperties": False,
          "properties": {key: {"type": "string"} for key in FIELDS},
          "required": list(FIELDS)}


class Generator:
    def __init__(self, token, model, request=request_json, sleep=time.sleep, clock=time.monotonic):
        require(bool(token), "OPENAI_API_KEY secret is missing")
        require(bool(model), "OPENAI_MODEL is missing")
        self.token, self.model = token, model
        self.request, self.sleep, self.clock = request, sleep, clock
        self.deadline = None

    def generate(self, context, previous=None, failure=None):
        if self.deadline is None:
            self.deadline = self.clock() + 35 * 60
        require(self.clock() < self.deadline, "Generation deadline expired")
        payload = {
            "model": self.model, "background": True, "max_output_tokens": 32768,
            "instructions": Path(__file__).with_name("generate.md").read_text(),
            "input": "INPUT\n" + json.dumps({"repository": context,
                "previous_candidate": previous, "failed_checks": failure}),
            "text": {"format": {"type": "json_schema", "name": "daily_game",
                                 "strict": True, "schema": SCHEMA}},
        }
        response = self.request("https://api.openai.com/v1/responses", self.token, payload)
        response_id = response.get("id", "")
        require(re.fullmatch(r"resp_[A-Za-z0-9_-]+", response_id), "Missing model response ID")
        while response.get("status") in ("queued", "in_progress"):
            if self.clock() >= self.deadline:
                self.request(f"https://api.openai.com/v1/responses/{response_id}/cancel", self.token, {})
                raise TimeoutError("Generation exceeded 35 minutes")
            self.sleep(10)
            response = self.request(f"https://api.openai.com/v1/responses/{response_id}", self.token)
        require(response.get("status") == "completed", "Model response did not complete")
        parts = [part.get("text", "") for item in response.get("output", [])
                 if item.get("type") == "message" for part in item.get("content", [])
                 if part.get("type") == "output_text"]
        require(bool(parts), "Model returned no source text")
        result = json.loads("".join(parts))
        require(set(result) == set(FIELDS), "Unexpected model source fields")
        require(all(isinstance(value, str) and 0 < len(value) <= 250000
                    for value in result.values()), "Invalid generated source size")
        return result, response_id
