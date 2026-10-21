"""Isolated comparator research: no LLM, credentials, or AgentShield runtime import.

The provider commits a SQLite effect before deliberately losing its first reply.
Workflow checkpoints use an in-memory saver: this tests exception/resume behavior,
not process-crash recovery, production concurrency, or any live provider guarantee.
"""

import http.client
from contextlib import closing
import importlib.metadata
import json
import os
import platform
import socket
import sqlite3
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Disable tracing before importing the comparator; never make a model request.
os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.func import entrypoint, task
from langgraph.types import Command, interrupt


def run_case(mode: str, scenario: str) -> dict:
    deduplicate = scenario == "ambiguous_with_provider_key"
    drop_reply = scenario != "completed_task_then_interrupt"
    requests = 0
    lock = threading.Lock()
    with tempfile.TemporaryDirectory(prefix="agentshield-comparator-") as directory:
        database = Path(directory) / "effects.sqlite"
        with closing(sqlite3.connect(database)) as connection, connection:
            connection.execute(
                "CREATE TABLE effect (id INTEGER PRIMARY KEY, operation_key TEXT NOT NULL)"
            )
            if deduplicate:
                connection.execute(
                    "CREATE UNIQUE INDEX effect_key ON effect(operation_key)"
                )

        def effect_count() -> int:
            with closing(sqlite3.connect(database)) as connection, connection:
                return connection.execute("SELECT count(*) FROM effect").fetchone()[0]

        class Provider(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                nonlocal requests
                assert self.path == "/effect"
                size = int(self.headers["content-length"])
                assert 0 < size <= 1024
                body = json.loads(self.rfile.read(size))
                assert body == {"operationKey": "one-logical-operation"}
                with lock:
                    requests += 1
                    ordinal = requests
                # The effect and provider-owned unique key share this commit.
                with closing(sqlite3.connect(database)) as connection, connection:
                    connection.execute(
                        "INSERT INTO effect(operation_key) VALUES (?) ON CONFLICT DO NOTHING",
                        (body["operationKey"],),
                    )
                    effect_id = connection.execute(
                        "SELECT max(id) FROM effect WHERE operation_key=?",
                        (body["operationKey"],),
                    ).fetchone()[0]
                if drop_reply and ordinal == 1:
                    # Closing AFTER commit creates an actually ambiguous HTTP result.
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                payload = json.dumps({"effectId": effect_id}).encode()
                self.send_response(201)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        endpoint = f"http://127.0.0.1:{server.server_port}/effect"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        @task
        def perform_effect():
            request = urllib.request.Request(
                endpoint,
                data=json.dumps({"operationKey": "one-logical-operation"}).encode(),
                headers={"content-type": "application/json"},
                method="POST",
            )
            with opener.open(request, timeout=3) as response:
                return json.load(response)

        @entrypoint(checkpointer=InMemorySaver())
        def workflow(_input):
            result = perform_effect().result()
            if scenario == "completed_task_then_interrupt":
                assert interrupt("Resume after the completed research task") is True
            return result

        config = {"configurable": {"thread_id": "isolated-research-thread"}}
        try:
            if drop_reply:
                try:
                    workflow.invoke({"start": True}, config, durability=mode)
                except (
                    http.client.RemoteDisconnected,
                    urllib.error.URLError,
                    ConnectionResetError,
                ):
                    pass
                else:
                    raise AssertionError("Expected lost acknowledgement after committed effect")
                assert requests == 1 and effect_count() == 1
                resumed = workflow.invoke(None, config, durability=mode)
            else:
                first = workflow.invoke({"start": True}, config, durability=mode)
                assert first["__interrupt__"]
                assert requests == 1 and effect_count() == 1
                resumed = workflow.invoke(Command(resume=True), config, durability=mode)
            expected_requests = 2 if drop_reply else 1
            expected_effects = 2 if drop_reply and not deduplicate else 1
            assert requests == expected_requests, (mode, scenario, requests)
            assert effect_count() == expected_effects, (mode, scenario, effect_count())
            assert resumed["effectId"] == expected_effects
            return {
                "mode": mode,
                "scenario": scenario,
                "httpRequests": requests,
                "committedEffects": effect_count(),
                "status": "PASS",
            }
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=3)
            assert not worker.is_alive()


def main():
    assert importlib.metadata.version("langgraph") == "1.2.16"
    cases = [
        run_case(mode, scenario)
        for mode in ("sync", "async", "exit")
        for scenario in (
            "completed_task_then_interrupt",
            "ambiguous_without_provider_key",
            "ambiguous_with_provider_key",
        )
    ]
    print(json.dumps({
        "schemaVersion": 1,
        "scope": "LOCAL_COMPARATOR_EXCEPTION_RESUME_ONLY",
        "python": platform.python_version(),
        "versions": {
            package: importlib.metadata.version(package)
            for package in ("langgraph", "langgraph-checkpoint", "langchain-core")
        },
        "cases": cases,
    }, indent=2))


if __name__ == "__main__":
    main()
