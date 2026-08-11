import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
