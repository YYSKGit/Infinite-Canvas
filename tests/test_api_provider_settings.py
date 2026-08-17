import asyncio
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

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
        self.assertEqual(main.venice_image_edit_model("CUSTOM-IMAGE", provider), "custom-image-edit")
        self.assertEqual(main.venice_video_text_model("CUSTOM-VIDEO", provider), "custom-text-video")
        self.assertIsNone(main.venice_image_edit_model("custom_image", provider))
        self.assertIsNone(main.venice_image_edit_model("unmapped-image", provider))

    def test_venice_catalog_allows_exact_direct_edit_and_text_video_models(self):
        provider = {"id": "venice-direct", "model_routes": {
            "base-image": {"image_edit": "missing-edit"},
            "reference-video": {"text_to_video": "missing-text-video"},
        }}
        catalog = main.normalize_venice_model_catalog({
            "image": {"models": [{"id": "base-image", "settings": {}}]},
            "inpaint": {"models": [{"id": "qwen-edit-uncensored", "settings": {}}]},
            "video": {"models": [
                {"id": "dual-purpose-video", "capabilities": {"textToVideo": True}, "settings": {}},
                {"id": "reference-video", "capabilities": {"textToVideo": False}, "settings": {}},
            ]},
        }, provider["id"])
        main.VENICE_MODEL_CATALOGS[main.venice_auth_cache_key(provider)] = catalog
        try:
            self.assertEqual(main.venice_image_edit_model("qwen-edit-uncensored", provider), "qwen-edit-uncensored")
            self.assertEqual(main.venice_video_text_model("dual-purpose-video", provider), "dual-purpose-video")
            self.assertIsNone(main.venice_image_edit_model("base-image", provider))
            self.assertIsNone(main.venice_video_text_model("reference-video", provider))
        finally:
            main.VENICE_MODEL_CATALOGS.pop(main.venice_auth_cache_key(provider), None)

    def test_venice_route_cannot_point_to_itself(self):
        with self.assertRaises(HTTPException):
            main.normalize_model_routes({"same-model": {"image_edit": "SAME-MODEL"}})
        self.assertEqual(
            main.normalize_model_routes({"same-model": {"image_edit": "same_model"}}),
            {"same-model": {"image_edit": "same_model"}},
        )

    def test_missing_venice_route_error_stays_compact(self):
        detail = main.venice_missing_model_route_detail("example-model", "image_edit")
        self.assertEqual(detail, "Venice 模型 example-model 未配置 I2I 关联模型，请到 API 设置补充或切换模型。")

    def test_public_venice_provider_never_uses_the_writable_client_field_for_preview(self):
        with patch.object(main, "venice_client_cookie_value", return_value="real-cookie-tail"):
            public = main.public_provider({"id": "venice", "name": "Venice", "protocol": "venice"})
        self.assertNotIn("__client", public)
        self.assertEqual(public["venice_client_preview"], "••••••••tail")

    def test_public_runninghub_provider_never_exposes_writable_key_fields(self):
        provider = {"id": "runninghub", "name": "RunningHub", "protocol": "runninghub"}
        with (
            patch.object(main, "runninghub_provider_with_workflow_store", side_effect=lambda item: item),
            patch.object(main, "provider_env_key_value", return_value="coin-key-tail"),
            patch.object(main, "runninghub_wallet_key_value", return_value="wallet-key-tail"),
        ):
            public = main.public_provider(provider)
        self.assertNotIn("api_key", public)
        self.assertNotIn("wallet_api_key", public)
        self.assertEqual(public["key_preview"], "••••••••tail")
        self.assertEqual(public["wallet_key_preview"], "••••••••tail")

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

    def test_venice_model_catalog_retains_future_metadata_and_drives_capability(self):
        provider = {"id": "venice"}
        raw = {
            "image": {"total": 1, "models": [{
                "id": "image-a",
                "apiModelId": "image-a-api",
                "averageExecutionTime": 12345,
                "settings": {
                    "aspectRatio": {"default": "1:1", "options": ["1:1", "16:9"]},
                    "resolution": {"default": "1K", "options": ["1K", "2K"]},
                    "quality": {"default": "medium", "options": ["low", "medium"]},
                    "futureSetting": {"enabled": True},
                },
                "capabilities": {"futureCapability": True},
            }]},
        }
        catalog = main.normalize_venice_model_catalog(raw, "venice")
        main.VENICE_MODEL_CATALOGS[main.venice_auth_cache_key(provider)] = catalog
        try:
            model = main.venice_catalog_model(provider, "IMAGE-A-API", ("image",))
            self.assertEqual(model["averageExecutionTime"], 12345)
            self.assertTrue(model["settings"]["futureSetting"]["enabled"])
            self.assertEqual(main.venice_catalog_model(provider, "image_a_api", ("image",)), {})
            self.assertEqual(main.venice_model_capability("image-a", provider), {
                "size_mode": "aspect_resolution",
                "supports_quality": True,
            })
        finally:
            main.VENICE_MODEL_CATALOGS.pop(main.venice_auth_cache_key(provider), None)

    def test_venice_model_catalog_fetch_uses_web_auth_and_expected_query_once(self):
        response = Mock()
        response.status_code = 200
        response.raise_for_status.return_value = None
        response.json.return_value = {"video": {"models": [], "total": 0}}
        client = AsyncMock()
        client.get.return_value = response
        provider = {"id": "venice-fetch-test"}
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(main, "VENICE_MODEL_CATALOG_CACHE_FILE", os.path.join(directory, "catalogs.json")),
            patch.object(main, "VENICE_MODEL_CATALOG_CACHE_LOADED", True),
            patch.object(main, "venice_web_auth_info", AsyncMock(return_value=("test-jwt", "user"))),
        ):
            catalog = asyncio.run(main.venice_fetch_model_catalog(client, provider))
        self.assertEqual(catalog["provider_id"], provider["id"])
        client.get.assert_awaited_once()
        args, kwargs = client.get.await_args
        self.assertEqual(args[0], main.VENICE_OUTERFACE_MODELS_URL)
        self.assertEqual(kwargs["params"], {"matureFilter": "false", "onlySafeVenice": "false"})
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer test-jwt")
        self.assertEqual(kwargs["headers"]["x-venice-middleface-version"], main.VENICE_OUTERFACE_VERSION)
        main.VENICE_MODEL_CATALOGS.pop(main.venice_auth_cache_key(provider), None)

    def test_missing_venice_catalog_fetch_is_single_flight(self):
        provider = {"id": "venice-single-flight", "protocol": "venice"}
        cache_key = main.venice_auth_cache_key(provider)
        catalog = main.normalize_venice_model_catalog({
            "image": {"models": [{"id": "image-a", "settings": {}}]},
        }, provider["id"])
        fetch_count = 0

        async def fake_fetch(_client, _provider):
            nonlocal fetch_count
            fetch_count += 1
            await asyncio.sleep(0.01)
            main.VENICE_MODEL_CATALOGS[cache_key] = catalog
            return catalog

        async def run_test():
            client = object()
            return await asyncio.gather(
                main.ensure_venice_model_catalog(provider, client),
                main.ensure_venice_model_catalog(provider, client),
            )

        main.VENICE_MODEL_CATALOGS.pop(cache_key, None)
        main.VENICE_MODEL_CATALOG_REFRESH_LOCKS.pop(cache_key, None)
        try:
            with patch.object(main, "venice_fetch_model_catalog", side_effect=fake_fetch):
                results = asyncio.run(run_test())
        finally:
            main.VENICE_MODEL_CATALOGS.pop(cache_key, None)
            main.VENICE_MODEL_CATALOG_REFRESH_LOCKS.pop(cache_key, None)
        self.assertEqual(fetch_count, 1)
        self.assertTrue(all(result["provider_id"] == provider["id"] for result in results))

    def test_startup_catalog_initialization_fetches_only_when_snapshot_is_missing(self):
        provider = {"id": "venice-startup-test", "protocol": "venice", "enabled": True}
        cache_key = main.venice_auth_cache_key(provider)
        catalog = main.normalize_venice_model_catalog({
            "image": {"models": [{"id": "image-a", "settings": {}}]},
        }, provider["id"])
        ensure = AsyncMock(return_value=catalog)
        common_patches = (
            patch.object(main, "load_api_providers", return_value=[provider]),
            patch.object(main, "venice_client_cookie_value", return_value="test-cookie"),
            patch.object(main, "load_persisted_venice_model_catalogs"),
            patch.object(main, "ensure_venice_model_catalog", ensure),
        )

        main.VENICE_MODEL_CATALOGS.pop(cache_key, None)
        try:
            with common_patches[0], common_patches[1], common_patches[2], common_patches[3]:
                asyncio.run(main.initialize_missing_venice_model_catalogs())
            ensure.assert_awaited_once_with(provider)

            ensure.reset_mock()
            main.VENICE_MODEL_CATALOGS[cache_key] = catalog
            with (
                patch.object(main, "load_api_providers", return_value=[provider]),
                patch.object(main, "venice_client_cookie_value", return_value="test-cookie"),
                patch.object(main, "load_persisted_venice_model_catalogs"),
                patch.object(main, "ensure_venice_model_catalog", ensure),
            ):
                asyncio.run(main.initialize_missing_venice_model_catalogs())
            ensure.assert_not_awaited()
        finally:
            main.VENICE_MODEL_CATALOGS.pop(cache_key, None)

    def test_venice_model_catalog_persists_and_supports_stale_server_fallback(self):
        provider = {"id": "venice-persist-test"}
        cache_key = main.venice_auth_cache_key(provider)
        catalog = main.normalize_venice_model_catalog({
            "image": {"models": [{"id": "image-a", "settings": {"widthHeightDivisor": 8}}]},
        }, provider["id"])
        with tempfile.TemporaryDirectory() as directory, patch.object(
            main, "VENICE_MODEL_CATALOG_CACHE_FILE", os.path.join(directory, "catalogs.json"),
        ):
            original_loaded = main.VENICE_MODEL_CATALOG_CACHE_LOADED
            try:
                main.VENICE_MODEL_CATALOG_CACHE_LOADED = True
                main.remember_venice_model_catalog(provider, catalog)
                main.VENICE_MODEL_CATALOGS.pop(cache_key, None)
                main.VENICE_MODEL_CATALOG_CACHE_LOADED = False

                restored = main.venice_catalog_for_provider(provider)
                stale = main.stale_venice_model_catalog(provider, "upstream unavailable")
            finally:
                main.VENICE_MODEL_CATALOGS.pop(cache_key, None)
                main.VENICE_MODEL_CATALOG_CACHE_LOADED = original_loaded

        self.assertEqual(restored["categories"]["image"]["models"][0]["id"], "image-a")
        self.assertTrue(stale["stale"])
        self.assertEqual(stale["refresh_error"], "upstream unavailable")

    def test_venice_catalog_endpoint_returns_last_good_snapshot_when_refresh_fails(self):
        provider = {"id": "venice-stale-endpoint", "name": "Venice", "protocol": "venice"}
        cache_key = main.venice_auth_cache_key(provider)
        catalog = main.normalize_venice_model_catalog({
            "image": {"models": [{"id": "image-a", "settings": {"widthHeightDivisor": 8}}]},
        }, provider["id"])
        main.VENICE_MODEL_CATALOGS[cache_key] = catalog

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                return False

        try:
            with (
                patch.object(main, "get_api_provider", return_value=provider),
                patch.object(main.httpx, "AsyncClient", FakeClient),
                patch.object(
                    main, "venice_fetch_model_catalog",
                    AsyncMock(side_effect=HTTPException(status_code=502, detail="refresh failed")),
                ),
            ):
                result = asyncio.run(main.get_venice_models_catalog(provider["id"]))
        finally:
            main.VENICE_MODEL_CATALOGS.pop(cache_key, None)

        self.assertTrue(result["stale"])
        self.assertEqual(result["refresh_error"], "refresh failed")
        self.assertEqual(result["categories"]["image"]["models"][0]["id"], "image-a")

    def test_invalid_user_agent_does_not_replace_last_browser_value(self):
        browser_user_agent = "Mozilla/5.0 TestBrowser/123.0"
        with patch.object(main, "VENICE_LAST_BROWSER_USER_AGENT", browser_user_agent):
            self.assertEqual(main.remember_venice_browser_user_agent("curl/8.0"), "")
            self.assertEqual(main.VENICE_LAST_BROWSER_USER_AGENT, browser_user_agent)

    def test_venice_credit_total_includes_purchased_balance_and_cycle_usage(self):
        response = AsyncMock()
        response.status_code = 200
        response.json = lambda: {"token": "test-token"}
        token_payload = {
            "veniceCredits": 8035,
            "bundledCreditsUsage": {
                "monthlyRefillCredits": 7500,
                "availableCredits": 7535,
                "usedThisCycle": 5,
            },
        }
        with (
            patch.object(main, "venice_web_request", AsyncMock(return_value=response)),
            patch.object(main, "venice_decode_jwt_payload", return_value=token_payload),
        ):
            usage = asyncio.run(main.venice_fetch_credit_usage(object(), {"id": "venice"}))

        self.assertEqual(usage["remaining_credits"], 8035)
        self.assertEqual(usage["total_credits"], 8040)
        self.assertEqual(usage["used_credits"], 5)
        self.assertEqual(usage["available_credits"], 7535)

    def test_venice_monthly_refill_remains_total_floor(self):
        response = AsyncMock()
        response.status_code = 200
        response.json = lambda: {"token": "test-token"}
        token_payload = {
            "veniceCredits": 7400,
            "bundledCreditsUsage": {
                "monthlyRefillCredits": 7500,
                "availableCredits": 7400,
                "usedThisCycle": 100,
            },
        }
        with (
            patch.object(main, "venice_web_request", AsyncMock(return_value=response)),
            patch.object(main, "venice_decode_jwt_payload", return_value=token_payload),
        ):
            usage = asyncio.run(main.venice_fetch_credit_usage(object(), {"id": "venice"}))

        self.assertEqual(usage["remaining_credits"], 7400)
        self.assertEqual(usage["total_credits"], 7500)
        self.assertEqual(usage["used_credits"], 100)


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
