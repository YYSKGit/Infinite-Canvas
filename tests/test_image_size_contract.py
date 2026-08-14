import asyncio
import unittest
from unittest.mock import patch

from fastapi import HTTPException

import main


class ImageSizeContractTests(unittest.TestCase):
    def test_online_request_accepts_structured_size_beside_legacy_size(self):
        payload = main.OnlineImageRequest(
            prompt="test",
            size="2048x1360",
            size_spec={"mode": "preset", "aspect_ratio": "3:2", "resolution": "2K"},
        )
        self.assertEqual(payload.size, "2048x1360")
        self.assertEqual(payload.size_spec.aspect_ratio, "3:2")

    def test_structured_preset_preserves_ratio_and_resolution(self):
        resolved = main.resolve_image_size_spec(
            "2048x1360",
            {"mode": "preset", "aspect_ratio": "3:2", "resolution": "2K"},
        )
        self.assertEqual(resolved["mode"], "preset")
        self.assertEqual(resolved["aspect_ratio"], "3:2")
        self.assertEqual(resolved["resolution"], "2K")
        self.assertEqual((resolved["width"], resolved["height"]), (2048, 1360))

    def test_legacy_frontend_preset_is_recognized_without_lossy_gcd(self):
        resolved = main.resolve_image_size_spec("2048x1360")
        self.assertEqual(resolved["mode"], "preset")
        self.assertEqual(resolved["aspect_ratio"], "3:2")
        self.assertEqual(resolved["resolution"], "2K")

    def test_legacy_arbitrary_pixels_remain_exact_custom_pixels(self):
        resolved = main.resolve_image_size_spec("1800x1200")
        self.assertEqual(resolved["mode"], "custom_pixels")
        self.assertEqual(resolved["aspect_ratio"], "3:2")
        self.assertEqual((resolved["width"], resolved["height"]), (1800, 1200))

    def test_auto_does_not_invent_ratio_or_dimensions(self):
        resolved = main.resolve_image_size_spec("auto", {"mode": "auto"})
        self.assertEqual(resolved, {
            "mode": "auto",
            "aspect_ratio": "",
            "resolution": "",
            "width": 0,
            "height": 0,
            "legacy_size": "auto",
        })

    def test_invalid_custom_pixels_are_rejected(self):
        with self.assertRaises(HTTPException):
            main.resolve_image_size_spec("", {"mode": "custom_pixels", "width": 0, "height": 1200})

    def test_apimart_uses_explicit_semantics_not_pixel_thresholds(self):
        ratio, resolution = main.apimart_size_resolution(
            "2048x1360",
            {"mode": "preset", "aspect_ratio": "3:2", "resolution": "2K"},
        )
        self.assertEqual((ratio, resolution), ("3:2", "2k"))

    def test_gemini_uses_explicit_aspect_and_tier(self):
        config = main.gemini_image_config(
            "2048x1360",
            {"mode": "preset", "aspect_ratio": "3:2", "resolution": "2K"},
        )
        self.assertEqual(config, {"aspectRatio": "3:2", "imageSize": "2K"})

    def test_gemini_auto_does_not_invent_an_image_config(self):
        self.assertEqual(main.gemini_image_config("auto", {"mode": "auto"}), {})

    def test_semantic_adapters_snap_only_unsupported_custom_ratios(self):
        spec = {"mode": "preset", "aspect_ratio": "7:5", "resolution": "2K"}
        apimart_ratio, _ = main.apimart_size_resolution("", spec)
        gemini = main.gemini_image_config("", spec)
        self.assertEqual(apimart_ratio, "4:3")
        self.assertEqual(gemini["aspectRatio"], "4:3")

    def test_runninghub_uses_explicit_aspect_and_tier(self):
        spec = {"mode": "preset", "aspect_ratio": "3:2", "resolution": "2K"}
        self.assertEqual(main.runninghub_aspect_from_size("2048x1360", size_spec=spec), "3:2")
        self.assertEqual(main.runninghub_resolution_from_size("2048x1360", size_spec=spec), "2k")

    def test_runninghub_quality_uses_explicit_selection_and_preserves_auto_default(self):
        field = {
            "fieldKey": "quality",
            "options": ["low", "high"],
            "defaultValue": "low",
        }
        self.assertIsNone(main.runninghub_requested_quality_value(field, "auto"))
        self.assertEqual(main.runninghub_requested_quality_value(field, "high"), "high")
        self.assertEqual(main.runninghub_requested_quality_value(field, "unsupported"), "low")


class VeniceImageCapabilityCompilerTests(unittest.TestCase):
    def setUp(self):
        self.provider = {
            "id": "venice",
            "protocol": "venice",
            "model_routes": {
                "gpt-image-2": {"image_edit": "gpt-image-2-edit"},
            },
            "image_capabilities": {
                "gpt-image-2": {
                    "size_mode": "aspect_resolution",
                    "supports_quality": True,
                },
                "qwen-image-2": {"size_mode": "aspect", "supports_quality": False},
                "qwen-image": {"size_mode": "pixel", "supports_quality": False},
                "z-image-turbo": {"size_mode": "pixel", "supports_quality": False},
            },
        }
        self.spec = {"mode": "preset", "aspect_ratio": "3:2", "resolution": "2K"}

    def test_resolution_model_keeps_selected_tier_and_standard_ratio(self):
        body = main.venice_outerface_image_body(
            "prompt", "2048x1360", "gpt-image-2", "user", self.spec, self.provider,
        )
        self.assertEqual(body["aspectRatio"], "3:2")
        self.assertEqual(body["resolution"], "2K")
        self.assertNotIn("width", body)
        self.assertNotIn("height", body)

    def test_aspect_model_only_receives_aspect(self):
        body = main.venice_outerface_image_body(
            "prompt", "2048x1360", "qwen-image-2", "user", self.spec, self.provider,
        )
        self.assertEqual(body["aspectRatio"], "3:2")
        self.assertNotIn("resolution", body)
        self.assertNotIn("width", body)

    def test_pixel_model_only_receives_clamped_pixels(self):
        body = main.venice_outerface_image_body(
            "prompt", "2048x1360", "qwen-image", "user", self.spec, self.provider,
        )
        self.assertEqual((body["width"], body["height"]), (1344, 892))
        self.assertNotIn("aspectRatio", body)
        self.assertNotIn("resolution", body)

    def test_all_resolution_presets_survive_venice_compilation(self):
        for aspect_ratio, tiers in main.IMAGE_SIZE_PRESETS.items():
            for resolution, (width, height) in tiers.items():
                with self.subTest(aspect_ratio=aspect_ratio, resolution=resolution):
                    spec = {"mode": "preset", "aspect_ratio": aspect_ratio, "resolution": resolution}
                    body = main.venice_outerface_image_body(
                        "prompt", f"{width}x{height}", "gpt-image-2", "user", spec, self.provider,
                    )
                    self.assertEqual(body["aspectRatio"], aspect_ratio)
                    self.assertEqual(body["resolution"], resolution)

    def test_provider_capability_override_wins_over_default(self):
        provider = {
            **self.provider,
            "image_capabilities": {
                **self.provider["image_capabilities"],
                "gpt-image-2": {"size_mode": "pixel", "supports_quality": True},
            },
        }
        body = main.venice_outerface_image_body(
            "prompt", "2048x1360", "gpt-image-2", "user", self.spec, provider,
        )
        self.assertIn("width", body)
        self.assertNotIn("resolution", body)

    def test_native_venice_body_uses_same_structured_contract(self):
        body = main.venice_image_request_body(
            "prompt", "2048x1360", "high", "gpt-image-2", self.spec, self.provider,
        )
        self.assertEqual(body["aspect_ratio"], "3:2")
        self.assertEqual(body["resolution"], "2K")
        self.assertEqual(body["quality"], "high")

    def test_quality_is_sent_only_for_models_that_declare_the_selected_option(self):
        supported = main.venice_outerface_image_body(
            "prompt", "2048x1360", "gpt-image-2", "user", self.spec, self.provider, "high",
        )
        unsupported = main.venice_outerface_image_body(
            "prompt", "2048x1360", "qwen-image-2", "user", self.spec, self.provider, "high",
        )
        automatic = main.venice_outerface_image_body(
            "prompt", "2048x1360", "gpt-image-2", "user", self.spec, self.provider, "auto",
        )
        self.assertEqual(supported["quality"], "high")
        self.assertNotIn("quality", unsupported)
        self.assertNotIn("quality", automatic)
        self.assertEqual(main.compile_venice_image_quality("best", "gpt-image-2", self.provider), "")
        self.assertEqual(main.compile_venice_image_quality("high", "gpt-image-2-edit", self.provider), "")

    def test_edit_request_sends_compiled_quality(self):
        captured = {}

        class FakeResponse:
            status_code = 200
            headers = {"content-type": "image/png"}

        class FakeClient:
            async def post(self, _url, **kwargs):
                captured["data"] = kwargs.get("data")
                return FakeResponse()

        async def fake_web_request(client, _provider, send):
            return await send("jwt", "user")

        with (
            patch.object(main, "venice_web_request", side_effect=fake_web_request),
            patch.object(main, "venice_raise_for_blocked_response"),
            patch.object(main, "venice_binary_image_response_to_data_url", return_value="data:image/png;base64,eA=="),
        ):
            asyncio.run(main.generate_venice_web_image_edit(
                FakeClient(),
                "edit prompt",
                "gpt-image-2",
                {"url": "data:image/png;base64,eA=="},
                self.provider,
                "high",
            ))
        self.assertEqual(captured["data"]["modelId"], "gpt-image-2-edit")
        self.assertEqual(captured["data"]["quality"], "high")

    def test_quote_and_generation_compile_the_same_quality(self):
        generation = main.venice_outerface_image_body(
            "prompt", "2048x1360", "gpt-image-2", "user", self.spec, self.provider, "medium",
        )
        quote = main.venice_image_quote_body("gpt-image-2", "2K", "medium", self.provider)
        self.assertEqual(generation["quality"], quote["variants"][0]["quality"])

    def test_free_quote_uses_the_same_resolved_request_semantics_without_network(self):
        payload = main.VeniceImageQuoteRequest(
            provider_id="venice",
            model="z-image-turbo",
            size="2048x1360",
            size_spec=self.spec,
        )
        with patch.object(main, "get_api_provider", return_value=self.provider):
            result = asyncio.run(main.get_venice_image_quote(payload))
        self.assertEqual(result["sizing_mode"], "pixel")
        self.assertEqual(result["aspect_ratio"], "3:2")
        self.assertEqual(result["resolution"], "2K")
        self.assertEqual(result["quality"], "auto")
        self.assertEqual(result["quote"], 0)

    def test_paid_quote_sends_compiled_quality_without_network(self):
        captured = {}

        class FakeResponse:
            status_code = 200
            headers = {}
            def json(self):
                return {"quote": 27}

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                return False
            async def post(self, _url, **kwargs):
                captured["body"] = kwargs.get("json")
                return FakeResponse()

        async def fake_web_request(client, _provider, send):
            return await send("jwt", "user")

        payload = main.VeniceImageQuoteRequest(
            provider_id="venice",
            model="gpt-image-2",
            size="2048x1360",
            size_spec=self.spec,
            quality="high",
            has_reference_image=True,
        )
        with (
            patch.object(main, "get_api_provider", return_value=self.provider),
            patch.object(main.httpx, "AsyncClient", FakeClient),
            patch.object(main, "venice_web_request", side_effect=fake_web_request),
        ):
            result = asyncio.run(main.get_venice_image_quote(payload))
        self.assertEqual(captured["body"]["variants"][0]["modelId"], "gpt-image-2-edit")
        self.assertEqual(captured["body"]["variants"][0]["quality"], "high")
        self.assertTrue(result["is_edit"])
        self.assertEqual(result["quality"], "high")


class ProviderImageCapabilityPersistenceTests(unittest.TestCase):
    def test_legacy_quality_options_migrate_to_boolean_capability(self):
        provider = main.normalize_provider({
            "id": "custom-api",
            "name": "Custom",
            "protocol": "openai",
            "image_models": ["model-a", "model-b"],
            "image_capabilities": {
                "model-a": {"size_mode": "aspect", "quality_options": ["high"]},
                "model-b": {"size_mode": "pixel", "quality_options": []},
            },
        })
        self.assertEqual(provider["image_capabilities"], {
            "model-a": {"size_mode": "aspect", "supports_quality": True},
            "model-b": {"size_mode": "pixel", "supports_quality": False},
        })

    def test_legacy_size_modes_migrate_to_model_capabilities(self):
        provider = main.normalize_provider({
            "id": "custom-api",
            "name": "Custom",
            "protocol": "openai",
            "image_models": ["model-a", "model-b"],
            "image_size_modes": {
                "model-a": "aspect-resolution",
                "model-b": "pixel",
                "removed-model": "aspect",
                "bad": "unknown",
            },
        })
        self.assertNotIn("image_size_modes", provider)
        self.assertEqual(provider["image_capabilities"], {
            "model-a": {"size_mode": "aspect_resolution", "supports_quality": False},
            "model-b": {"size_mode": "pixel", "supports_quality": False},
        })

    def test_venice_capabilities_exactly_follow_current_models(self):
        provider = main.normalize_provider({
            "id": "venice",
            "name": "Venice",
            "protocol": "venice",
            "image_models": ["gpt-image-2", "qwen-image-2", "new-model"],
            "image_capabilities": {
                "gpt-image-2": {"size_mode": "pixel", "supports_quality": True},
                "removed-model": {"size_mode": "aspect", "supports_quality": True},
            },
        })
        self.assertEqual(provider["image_capabilities"], {
            "gpt-image-2": {"size_mode": "pixel", "supports_quality": True},
            "qwen-image-2": {"size_mode": "aspect", "supports_quality": False},
            "new-model": {"size_mode": "aspect_resolution", "supports_quality": False},
        })

    def test_default_venice_capabilities_do_not_include_unselected_models(self):
        provider = next(item for item in main.default_api_providers() if item["id"] == "venice")
        self.assertEqual(set(provider["image_capabilities"]), set(provider["image_models"]))
        self.assertTrue(provider["image_capabilities"]["gpt-image-2"]["supports_quality"])

    def test_venice_override_registry_only_contains_non_default_modes(self):
        explicit_size_modes = {
            capability.get("size_mode")
            for capability in main.VENICE_IMAGE_CAPABILITY_OVERRIDES.values()
            if capability.get("size_mode")
        }
        self.assertNotIn(main.VENICE_DEFAULT_IMAGE_SIZE_MODE, explicit_size_modes)
        self.assertNotIn("gpt-image-2-edit", main.VENICE_IMAGE_CAPABILITY_OVERRIDES)


if __name__ == "__main__":
    unittest.main()
