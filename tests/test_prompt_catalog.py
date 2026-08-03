import json
import os
import tempfile
import unittest

from prompt_catalog import (
    PromptCatalogValidationError,
    load_prompt_catalog,
    normalize_generation_prompt,
    normalize_prompt_catalog,
    normalize_system_instruction,
    save_prompt_catalog,
)


class PromptCatalogTests(unittest.TestCase):
    def test_builtin_catalog_contains_reviewed_generation_and_system_content(self):
        path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "static", "system-prompts", "prompt-catalog.json",
        )
        with open(path, "r", encoding="utf-8") as file:
            catalog = normalize_prompt_catalog(json.load(file))
        self.assertEqual(len(catalog["generation_prompts"]), 9)
        self.assertEqual(len(catalog["system_instructions"]), 7)
        for item in catalog["generation_prompts"]:
            self.assertEqual(item["prompt_template"].count("{{user_prompt}}"), 1)
            self.assertNotIn("negative", item)
            self.assertNotIn("model", item)
            self.assertNotIn("quality", item)
            self.assertNotIn("count", item)

    def test_generation_prompt_requires_exactly_one_user_token(self):
        base = {"name": "角色三视图", "prompt_template": "要求：{{user_prompt}}"}
        normalized = normalize_generation_prompt(base, timestamp=100)
        self.assertEqual(normalized["recommended_ratio"], "")
        self.assertEqual(normalized["created_at"], 100)

        for template in ("没有变量", "{{user_prompt}} 和 {{user_prompt}}"):
            with self.subTest(template=template):
                with self.assertRaises(PromptCatalogValidationError):
                    normalize_generation_prompt({**base, "prompt_template": template})

    def test_generation_prompt_normalizes_only_ratio_and_resolution_recommendations(self):
        normalized = normalize_generation_prompt({
            "name": "产品设定图",
            "prompt_template": "{{user_prompt}}",
            "recommended_ratio": " 16 : 9 ",
            "recommended_resolution": "2048 x 2048",
        })
        self.assertEqual(normalized["recommended_ratio"], "16:9")
        self.assertEqual(normalized["recommended_resolution"], "2048×2048")
        self.assertNotIn("model", normalized)
        self.assertNotIn("quality", normalized)
        self.assertNotIn("count", normalized)

    def test_system_instruction_keeps_its_existing_prompt_variables(self):
        normalized = normalize_system_instruction({
            "name": "专业润色",
            "system_template": "只返回修改后的提示词。",
            "user_template": "处理以下内容：{{prompt}}",
        })
        self.assertIn("{{prompt}}", normalized["user_template"])

    def test_catalog_drops_invalid_and_duplicate_items(self):
        normalized = normalize_prompt_catalog({
            "generation_prompts": [
                {"id": "same", "name": "有效", "prompt_template": "{{user_prompt}}"},
                {"id": "same", "name": "重复", "prompt_template": "{{user_prompt}}"},
                {"id": "broken", "name": "无变量", "prompt_template": "普通文本"},
            ]
        })
        self.assertEqual([item["name"] for item in normalized["generation_prompts"]], ["有效"])

    def test_catalog_save_is_valid_json_and_round_trips(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "prompt_catalog.json")
            saved = save_prompt_catalog(path, {
                "generation_prompts": [
                    {"id": "one", "name": "九宫格", "prompt_template": "{{user_prompt}}"}
                ],
                "system_instructions": [],
            })
            with open(path, "r", encoding="utf-8") as file:
                json.load(file)
            self.assertEqual(load_prompt_catalog(path), saved)


if __name__ == "__main__":
    unittest.main()
