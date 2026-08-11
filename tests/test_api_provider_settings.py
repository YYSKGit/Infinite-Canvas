import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import main


class ApiProviderSettingsTests(unittest.TestCase):
    def test_masked_secret_inputs_are_rejected(self):
        for value in ("••••••••abcd", "********abcd", "保持当前 Key", "...abcd"):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                main.validate_secret_input(value, "测试 Key")
        self.assertEqual(main.validate_secret_input("  real-secret  ", "测试 Key"), "real-secret")

    def test_venice_provider_seeds_routes_for_legacy_config(self):
        provider = main.normalize_provider({
            "id": "venice",
            "name": "Venice",
            "protocol": "venice",
            "image_models": ["qwen-image-2"],
            "video_models": ["seedance-2-0-enhanced-reference-to-video"],
        })
        self.assertEqual(provider["model_routes"]["qwen-image-2"]["image_edit"], "qwen-image-2-edit")
        self.assertEqual(
            provider["model_routes"]["seedance-2-0-enhanced-reference-to-video"]["text_to_video"],
            "seedance-2-0-enhanced-text-to-video",
        )

    def test_venice_custom_routes_drive_both_resolvers(self):
        provider = {"model_routes": {
            "custom-image": {"image_edit": "custom-image-edit"},
            "custom-video": {"text_to_video": "custom-text-video"},
        }}
        self.assertEqual(main.venice_image_edit_model("custom_image", provider), "custom-image-edit")
        self.assertEqual(main.venice_video_text_model("CUSTOM-VIDEO", provider), "custom-text-video")
        self.assertIsNone(main.venice_image_edit_model("unmapped-image", provider))

    def test_venice_route_cannot_point_to_itself(self):
        with self.assertRaises(HTTPException):
            main.normalize_model_routes({"same-model": {"image_edit": "same_model"}})

    def test_public_venice_provider_never_uses_the_writable_client_field_for_preview(self):
        with patch.object(main, "venice_client_cookie_value", return_value="real-cookie-tail"):
            public = main.public_provider({"id": "venice", "name": "Venice", "protocol": "venice"})
        self.assertNotIn("__client", public)
        self.assertEqual(public["venice_client_preview"], "••••••••tail")

    def test_venice_web_headers_add_configured_browser_user_agent(self):
        with patch.object(main, "VENICE_LAST_BROWSER_USER_AGENT", ""):
            headers = main.venice_web_headers({"Accept": "application/json"})
        self.assertEqual(headers["User-Agent"], main.VENICE_WEB_USER_AGENT)
        self.assertIn("Mozilla/5.0", headers["User-Agent"])
        self.assertEqual(headers["Accept"], "application/json")

    def test_venice_web_headers_do_not_mutate_input(self):
        original = {"Authorization": "Bearer test"}
        headers = main.venice_web_headers(original)
        self.assertNotIn("User-Agent", original)
        self.assertEqual(headers["Authorization"], "Bearer test")

    def test_venice_web_headers_prefer_last_browser_user_agent(self):
        browser_user_agent = "Mozilla/5.0 TestBrowser/123.0"
        with patch.object(main, "VENICE_LAST_BROWSER_USER_AGENT", browser_user_agent):
            headers = main.venice_web_headers()
        self.assertEqual(headers["User-Agent"], browser_user_agent)

    def test_invalid_user_agent_does_not_replace_last_browser_value(self):
        browser_user_agent = "Mozilla/5.0 TestBrowser/123.0"
        with patch.object(main, "VENICE_LAST_BROWSER_USER_AGENT", browser_user_agent):
            self.assertEqual(main.remember_venice_browser_user_agent("curl/8.0"), "")
            self.assertEqual(main.VENICE_LAST_BROWSER_USER_AGENT, browser_user_agent)


class FakeBrowserWebSocket:
    def __init__(self, user_agent):
        self.headers = {"user-agent": user_agent}
        self.messages = []

    async def accept(self):
        return None

    async def send_text(self, value):
        self.messages.append(value)


class VeniceBrowserPresenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.original_connections = list(main.manager.active_connections)
        self.original_user_connections = dict(main.manager.user_connections)
        self.original_connection_clients = dict(main.manager.connection_clients)
        self.original_presence_event = main.VENICE_BROWSER_ONLINE_EVENT
        self.original_user_agent = main.VENICE_LAST_BROWSER_USER_AGENT
        main.manager.active_connections.clear()
        main.manager.user_connections.clear()
        main.manager.connection_clients.clear()
        main.VENICE_BROWSER_ONLINE_EVENT = asyncio.Event()
        main.VENICE_LAST_BROWSER_USER_AGENT = ""

    async def asyncTearDown(self):
        main.manager.active_connections[:] = self.original_connections
        main.manager.user_connections.clear()
        main.manager.user_connections.update(self.original_user_connections)
        main.manager.connection_clients.clear()
        main.manager.connection_clients.update(self.original_connection_clients)
        main.VENICE_BROWSER_ONLINE_EVENT = self.original_presence_event
        main.VENICE_LAST_BROWSER_USER_AGENT = self.original_user_agent

    async def test_two_tabs_keep_presence_online_until_both_disconnect(self):
        first = FakeBrowserWebSocket("Mozilla/5.0 FirstBrowser/1.0")
        second = FakeBrowserWebSocket("Mozilla/5.0 SecondBrowser/2.0")

        await main.manager.connect(first, "shared-client")
        await main.manager.connect(second, "shared-client")
        self.assertTrue(main.VENICE_BROWSER_ONLINE_EVENT.is_set())
        self.assertEqual(len(main.manager.active_connections), 2)
        self.assertEqual(main.VENICE_LAST_BROWSER_USER_AGENT, "Mozilla/5.0 SecondBrowser/2.0")

        await main.manager.disconnect(first, "shared-client")
        self.assertTrue(main.VENICE_BROWSER_ONLINE_EVENT.is_set())
        self.assertEqual(len(main.manager.active_connections), 1)

        await main.manager.disconnect(second, "shared-client")
        self.assertFalse(main.VENICE_BROWSER_ONLINE_EVENT.is_set())
        self.assertEqual(len(main.manager.active_connections), 0)

    async def test_refresh_loop_waits_offline_and_stops_after_last_tab_closes(self):
        refresh = AsyncMock()
        loop_task = None
        try:
            with patch.object(main, "refresh_configured_venice_web_auth", refresh), patch.object(main, "VENICE_AUTH_REFRESH_SECONDS", 0.02):
                loop_task = asyncio.create_task(main.venice_auth_refresh_loop())
                await asyncio.sleep(0.03)
                refresh.assert_not_awaited()

                tab = object()
                main.manager.active_connections.append(tab)
                main.sync_venice_browser_presence()
                await asyncio.sleep(0.01)
                self.assertEqual(refresh.await_args_list[0].kwargs, {"force_refresh": False})

                main.manager.active_connections.remove(tab)
                main.sync_venice_browser_presence()
                calls_after_close = refresh.await_count
                await asyncio.sleep(0.04)
                self.assertEqual(refresh.await_count, calls_after_close)
        finally:
            if loop_task is not None:
                loop_task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await loop_task

    async def test_refresh_loop_prewarms_once_then_keeps_auth_hot_while_online(self):
        refresh = AsyncMock()
        loop_task = None
        tab = object()
        main.manager.active_connections.append(tab)
        main.sync_venice_browser_presence()
        try:
            with patch.object(main, "refresh_configured_venice_web_auth", refresh), patch.object(main, "VENICE_AUTH_REFRESH_SECONDS", 0.02):
                loop_task = asyncio.create_task(main.venice_auth_refresh_loop())
                await asyncio.sleep(0.05)
                self.assertGreaterEqual(refresh.await_count, 2)
                self.assertEqual(refresh.await_args_list[0].kwargs, {"force_refresh": False})
                self.assertEqual(refresh.await_args_list[1].kwargs, {"force_refresh": True})
        finally:
            main.manager.active_connections.remove(tab)
            main.sync_venice_browser_presence()
            if loop_task is not None:
                loop_task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await loop_task


if __name__ == "__main__":
    unittest.main()
