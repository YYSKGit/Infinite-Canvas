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

    def test_auto_aspect_keeps_resolution_without_inventing_ratio_or_dimensions(self):
        resolved = main.resolve_image_size_spec(
            "2K", {"mode": "auto_aspect", "resolution": "2K"},
        )
        self.assertEqual(resolved, {
            "mode": "auto_aspect",
            "aspect_ratio": "",
            "resolution": "2K",
            "width": 0,
            "height": 0,
            "legacy_size": "2K",
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

    def test_auto_aspect_adapters_keep_resolution_and_omit_ratio(self):
        spec = {"mode": "auto_aspect", "resolution": "2K"}
        self.assertEqual(main.gemini_image_config("2K", spec), {"imageSize": "2K"})
        self.assertEqual(main.apimart_size_resolution("2K", spec), ("", "2k"))
        self.assertEqual(main.runninghub_aspect_from_size("2K", size_spec=spec), "")
        self.assertEqual(main.runninghub_resolution_from_size("2K", size_spec=spec), "2k")

    def test_generic_openai_auto_aspect_omits_size_and_keeps_selected_quality(self):
        captured = {}
        provider = {
            "id": "custom-openai",
            "name": "Custom OpenAI",
            "protocol": "openai",
            "base_url": "https://example.invalid/v1",
            "api_key": "test-key",
            "image_request_mode": "openai",
        }

        class FakeResponse:
            status_code = 200
            text = ""
            headers = {}
            def raise_for_status(self):
                return None
            def json(self):
                return {"data": [{"url": "https://example.invalid/image.png"}]}

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

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="test-key"),
            patch.object(main.httpx, "AsyncClient", FakeClient),
        ):
            asyncio.run(main.generate_ai_image(
                "prompt", "2K", "medium", "image-model",
                provider_id="custom-openai",
                size_spec={"mode": "auto_aspect", "resolution": "2K"},
            ))
        self.assertNotIn("size", captured["body"])
        self.assertEqual(captured["body"]["quality"], "medium")

    def test_api_image_parameter_schema_matches_compact_control(self):
        provider = {"id": "venice-param-schema", "protocol": "venice"}
        catalog = main.normalize_venice_model_catalog({
            "image": {"models": [
                {"id": "image-model", "settings": {
                    "aspectRatio": {"options": ["auto", "1:1"]},
                    "resolution": {"options": ["1K", "2K", "4K"]},
                    "quality": {"options": ["low", "medium", "high"]},
                }},
                {"id": "pixel-model", "settings": {"widthHeightDivisor": 8}},
            ]},
        }, provider["id"])
        cache_key = main.venice_auth_cache_key(provider)
        main.VENICE_MODEL_CATALOGS[cache_key] = catalog
        self.addCleanup(main.VENICE_MODEL_CATALOGS.pop, cache_key, None)

        fields = main.build_image_param_fields("api", provider, "image-model")
        size_field = next(field for field in fields if field["key"] == "size")
        quality_field = next(field for field in fields if field["key"] == "quality")
        count_field = next(field for field in fields if field["key"] == "n")
        self.assertEqual(size_field["ratios"][0], {"value": "auto", "label": "自动"})
        self.assertEqual([item["value"] for item in size_field["resolutions"]], ["1k", "2k", "4k"])
        self.assertEqual([item["value"] for item in quality_field["options"]], ["low", "medium", "high"])
        self.assertEqual(quality_field["default"], "medium")
        self.assertEqual(count_field["options"], [1, 2, 4])

        pixel_fields = main.build_image_param_fields("api", provider, "pixel-model")
        pixel_size = next(field for field in pixel_fields if field["key"] == "size")
        self.assertNotIn("auto", [item["value"] for item in pixel_size["ratios"]])
        self.assertNotIn("quality", [field["key"] for field in pixel_fields])

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
            "id": "venice-contract-tests",
            "protocol": "venice",
            "model_routes": {
                "gpt-image-2": {"image_edit": "gpt-image-2-edit"},
                "qwen-image-2": {"image_edit": "qwen-edit-uncensored"},
            },
        }
        self.spec = {"mode": "preset", "aspect_ratio": "3:2", "resolution": "2K"}
        catalog = main.normalize_venice_model_catalog({
            "image": {"models": [
                {"id": "gpt-image-2", "settings": {
                    "aspectRatio": {"options": ["auto", "3:2"]},
                    "resolution": {"options": ["1K", "2K", "4K"]},
                    "quality": {"options": ["low", "medium", "high"]},
                }},
                {"id": "qwen-image-2", "settings": {"aspectRatio": {"options": ["auto", "3:2"]}}},
                {"id": "qwen-image", "settings": {"widthHeightDivisor": 8}},
                {"id": "z-image-turbo", "settings": {"widthHeightDivisor": 8}},
            ]},
            "inpaint": {"models": [{"id": "gpt-image-2-edit", "settings": {
                "aspectRatio": {"options": ["auto", "3:2"]},
                "resolution": {"options": ["1K", "2K", "4K"]},
            }}, {"id": "qwen-edit-uncensored", "settings": {
                "aspectRatio": {"options": ["auto", "3:2"]},
                "resolution": {"options": ["1K", "2K", "4K"]},
                "quality": {"options": ["high"]},
            }}]},
        }, self.provider["id"])
        self.cache_key = main.venice_auth_cache_key(self.provider)
        main.VENICE_MODEL_CATALOGS[self.cache_key] = catalog

    def tearDown(self):
        main.VENICE_MODEL_CATALOGS.pop(self.cache_key, None)

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

    def test_retired_provider_metadata_cannot_override_catalog(self):
        retired_field = "_".join(("image", "capabilities"))
        provider = {
            **self.provider,
            retired_field: {
                "gpt-image-2": {"size_mode": "pixel", "supports_quality": True},
            },
        }
        body = main.venice_outerface_image_body(
            "prompt", "2048x1360", "gpt-image-2", "user", self.spec, provider,
        )
        self.assertNotIn("width", body)
        self.assertEqual(body["resolution"], "2K")

    def test_native_venice_body_uses_same_structured_contract(self):
        body = main.venice_image_request_body(
            "prompt", "2048x1360", "high", "gpt-image-2", self.spec, self.provider,
        )
        self.assertEqual(body["aspect_ratio"], "3:2")
        self.assertEqual(body["resolution"], "2K")
        self.assertEqual(body["quality"], "high")

    def test_auto_aspect_omits_ratio_but_keeps_supported_resolution(self):
        spec = {"mode": "auto_aspect", "resolution": "2K"}
        resolution_body = main.venice_outerface_image_body(
            "prompt", "2K", "gpt-image-2", "user", spec, self.provider,
        )
        aspect_body = main.venice_outerface_image_body(
            "prompt", "2K", "qwen-image-2", "user", spec, self.provider,
        )
        pixel_body = main.venice_outerface_image_body(
            "prompt", "2K", "qwen-image", "user", spec, self.provider,
        )
        self.assertNotIn("aspectRatio", resolution_body)
        self.assertEqual(resolution_body["resolution"], "2K")
        self.assertNotIn("aspectRatio", aspect_body)
        self.assertNotIn("resolution", aspect_body)
        self.assertNotIn("width", pixel_body)
        self.assertNotIn("height", pixel_body)

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
        self.assertEqual(main.compile_venice_image_quality("high", "qwen-edit-uncensored", self.provider), "high")

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
            patch.object(main, "venice_image_edit_size_fields", wraps=main.venice_image_edit_size_fields) as size_fields,
        ):
            asyncio.run(main.generate_venice_web_image_edit(
                FakeClient(),
                "edit prompt",
                "qwen-image-2",
                {"url": "data:image/png;base64,eA=="},
                self.provider,
                "high",
                "2048x1360",
                self.spec,
            ))
        self.assertEqual(captured["data"]["modelId"], "qwen-edit-uncensored")
        self.assertEqual(captured["data"]["quality"], "high")
        self.assertEqual(captured["data"]["aspectRatio"], "3:2")
        self.assertEqual(captured["data"]["resolution"], "2K")
        self.assertEqual(size_fields.call_args.args[2], "qwen-edit-uncensored")

    def test_edit_auto_aspect_omits_ratio_but_keeps_selected_resolution(self):
        fields = main.venice_image_edit_size_fields(
            "2K",
            {"mode": "auto_aspect", "resolution": "2K"},
            "gpt-image-2",
            self.provider,
        )
        self.assertEqual(fields, {"resolution": "2K"})

    def test_edit_aspect_only_model_never_sends_resolution(self):
        fields = main.venice_image_edit_size_fields(
            "2048x1360",
            self.spec,
            "qwen-image-2",
            self.provider,
        )
        self.assertEqual(fields, {"aspectRatio": "3:2"})

        automatic = main.venice_image_edit_size_fields(
            "2K",
            {"mode": "auto_aspect", "resolution": "2K"},
            "qwen-image-2",
            self.provider,
        )
        self.assertEqual(automatic, {})

    def test_routed_edit_size_uses_the_actual_inpaint_catalog_model(self):
        provider = {
            "id": "venice-routed-edit-size",
            "protocol": "venice",
            "model_routes": {"z-image-turbo": {"image_edit": "qwen-edit-uncensored"}},
        }
        catalog = main.normalize_venice_model_catalog({
            "image": {"models": [{"id": "z-image-turbo", "settings": {"widthHeightDivisor": 8}}]},
            "inpaint": {"models": [{
                "id": "qwen-edit-uncensored",
                "settings": {"aspectRatio": {"default": "auto", "options": ["auto", "3:2"]}},
            }]},
        }, provider["id"])
        cache_key = main.venice_auth_cache_key(provider)
        main.VENICE_MODEL_CATALOGS[cache_key] = catalog
        try:
            edit_model = main.venice_image_edit_model("z-image-turbo", provider)
            fields = main.venice_image_edit_size_fields(
                "2048x1360", self.spec, edit_model, provider,
            )
        finally:
            main.VENICE_MODEL_CATALOGS.pop(cache_key, None)
        self.assertEqual(edit_model, "qwen-edit-uncensored")
        self.assertEqual(fields, {"aspectRatio": "3:2"})

    def test_missing_catalog_or_model_fails_closed_instead_of_guessing_parameters(self):
        with self.assertRaises(HTTPException) as missing_catalog:
            main.compile_venice_image_size(
                "2048x1360", "unknown-model", self.spec,
                {"id": "venice-no-catalog", "protocol": "venice"},
            )
        self.assertEqual(missing_catalog.exception.status_code, 409)

        with self.assertRaises(HTTPException) as wrong_model:
            main.compile_venice_image_size("2048x1360", "wrong-model", self.spec, self.provider)
        self.assertEqual(wrong_model.exception.status_code, 400)

    def test_edit_full_auto_omits_all_size_fields(self):
        self.assertEqual(
            main.venice_image_edit_size_fields(
                "auto",
                {"mode": "auto"},
                "gpt-image-2",
                self.provider,
            ),
            {},
        )

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

    def test_paid_edit_quote_omits_quality_not_supported_by_routed_model(self):
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
        self.assertNotIn("quality", captured["body"]["variants"][0])
        self.assertTrue(result["is_edit"])
        self.assertEqual(result["quality"], "auto")

    def test_free_edit_quote_uses_routed_models_quality_contract(self):
        payload = main.VeniceImageQuoteRequest(
            provider_id="venice",
            model="qwen-image-2",
            size="2048x1360",
            size_spec=self.spec,
            quality="high",
            has_reference_image=True,
        )
        with patch.object(main, "get_api_provider", return_value=self.provider):
            result = asyncio.run(main.get_venice_image_quote(payload))
        self.assertEqual(result["model"], "qwen-edit-uncensored")
        self.assertEqual(result["quality"], "high")
        self.assertEqual(result["quote"], 0)


class RetiredProviderImageMetadataTests(unittest.TestCase):
    def test_normalization_discards_retired_image_metadata(self):
        retired_contract_field = "_".join(("image", "capabilities"))
        retired_size_field = "_".join(("image", "size", "modes"))
        provider = main.normalize_provider({
            "id": "venice",
            "name": "Venice",
            "protocol": "venice",
            "image_models": ["gpt-image-2"],
            retired_contract_field: {"gpt-image-2": {"size_mode": "pixel"}},
            retired_size_field: {"gpt-image-2": "pixel"},
        })
        self.assertNotIn(retired_contract_field, provider)
        self.assertNotIn(retired_size_field, provider)

    def test_default_provider_contains_no_retired_image_metadata(self):
        retired_contract_field = "_".join(("image", "capabilities"))
        provider = next(item for item in main.default_api_providers() if item["id"] == "venice")
        self.assertNotIn(retired_contract_field, provider)


if __name__ == "__main__":
    unittest.main()
