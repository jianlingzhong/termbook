import asyncio
import websockets
import json
import re
import pytest

# OSC 133 Sequences
OSC_START_OUTPUT = "\x1b]133;C\x07"
OSC_END_OUTPUT = "\x1b]133;D;" # followed by exit code

async def test_shell_integration():
    uri = "ws://127.0.0.1:4001"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected.")
            # 1. Start/Join Session
            print("Connected.")
            # 1. Start/Join Session
            session_id = "test-session-osc133"
            await websocket.send(json.dumps({
                "type": "join_session",
                "sessionId": session_id
            }))

            # Wait for session_init
            init_response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
            init_data = json.loads(init_response)
            assert init_data.get("type") == "session_init", f"Expected session_init, got {init_data}"

            # 2. Send Command
            test_message = "echo 'OSC_TEST_MARKER'"
            # Use 'start' to trigger a new cell execution
            await websocket.send(json.dumps({
                "type": "start",
                "cellId": "test-cell-1",
                "data": test_message
            }))

            # 3. Listen for Output
            accumulated_output = ""
            found_start = False
            found_end = False
            found_content = False

            try:
                while True:
                    response = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                    data = json.loads(response)

                    if data.get("type") == "output":
                        content = data.get("data", "")
                        accumulated_output += content

                        if OSC_START_OUTPUT in content:
                            found_start = True

                        if "OSC_TEST_MARKER" in content:
                            found_content = True

                    elif data.get("type") == "exit":
                        # Exit message might confirm command done
                        found_end = True
                        break

                    # Also check accumulated output for END sequence
                    if OSC_END_OUTPUT in accumulated_output:
                        found_end = True

            except asyncio.TimeoutError:
                pytest.fail(f"Timeout waiting for command output. Got: {accumulated_output}")

            assert found_start, f"Missing OSC 133 Start Output sequence. Got: {accumulated_output!r}"
            assert found_content, f"Missing command output content. Got: {accumulated_output!r}"
            assert OSC_END_OUTPUT in accumulated_output, f"Missing OSC 133 End Output sequence in raw output. Got: {accumulated_output!r}"

            print("\n✅ Shell Integration Test Passed: OSC sequences detected.")

    except Exception as e:
        print(f"Connection failed: {e}")
        raise

if __name__ == "__main__":
    try:
        asyncio.run(test_shell_integration())
    except Exception as e:
        print(f"\n❌ Test Failed: {e}")
        exit(1)
