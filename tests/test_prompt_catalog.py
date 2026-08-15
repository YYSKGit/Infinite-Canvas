import json
import os
import tempfile
import unittest

from prompt_catalog import (
    PromptCatalogValidationError,
    find_builtin_prompt_catalog_item,
    load_prompt_catalog,
    mark_prompt_catalog_builtins,
    merge_missing_prompt_catalog_builtins,
    normalize_generation_prompt,
    normalize_prompt_catalog,
    normalize_system_instruction,
    remove_retired_prompt_catalog_builtins,
    reorder_prompt_catalog_category,
    restore_builtin_prompt_catalog_item,
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
        self.assertEqual(len(catalog["generation_prompts"]), 8)
        self.assertEqual(len(catalog["system_instructions"]), 7)
        self.assertEqual(
            [item["id"] for item in catalog["generation_prompts"] if item["category"] == "设定图"],
            ["character_reference_sheet", "character_face_three_views", "product_three_views"],
        )
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

    def test_generation_prompts_reorder_only_inside_the_requested_category(self):
        catalog = normalize_prompt_catalog({
            "generation_prompts": [
                {"id": "story", "name": "分镜", "category": "分镜", "prompt_template": "{{user_prompt}}"},
                {"id": "face", "name": "脸部", "category": "设定图", "prompt_template": "{{user_prompt}}"},
                {"id": "light", "name": "光影", "category": "质感", "prompt_template": "{{user_prompt}}"},
                {"id": "product", "name": "产品", "category": "设定图", "prompt_template": "{{user_prompt}}"},
                {"id": "character", "name": "角色", "category": "设定图", "prompt_template": "{{user_prompt}}"},
            ]
        })
        reordered = reorder_prompt_catalog_category(
            catalog,
            "generation_prompts",
            "设定图",
            ["character", "face", "product"],
        )
        self.assertEqual(
            [item["id"] for item in reordered["generation_prompts"]],
            ["story", "character", "light", "face", "product"],
        )

        with self.assertRaises(PromptCatalogValidationError):
            reorder_prompt_catalog_category(
                catalog,
                "generation_prompts",
                "设定图",
                ["character", "face"],
            )

    def test_builtin_items_are_derived_from_default_ids(self):
        defaults = {
            "generation_prompts": [
                {"id": "builtin", "name": "内置", "prompt_template": "{{user_prompt}}"}
            ],
            "system_instructions": [],
        }
        catalog = {
            "generation_prompts": [
                {"id": "builtin", "name": "已修改", "prompt_template": "修改 {{user_prompt}}"},
                {"id": "custom", "name": "自定义", "prompt_template": "{{user_prompt}}"},
            ],
            "system_instructions": [],
        }
        marked = mark_prompt_catalog_builtins(catalog, defaults)
        self.assertTrue(marked["generation_prompts"][0]["builtin"])
        self.assertFalse(marked["generation_prompts"][1]["builtin"])
        self.assertIsNotNone(find_builtin_prompt_catalog_item(defaults, "generation_prompts", "builtin"))
        self.assertIsNone(find_builtin_prompt_catalog_item(defaults, "generation_prompts", "custom"))

    def test_builtin_item_can_restore_default_without_changing_created_time(self):
        defaults = {
            "generation_prompts": [
                {"id": "builtin", "name": "默认名称", "prompt_template": "默认 {{user_prompt}}"}
            ]
        }
        catalog = {
            "generation_prompts": [
                {
                    "id": "builtin",
                    "name": "本地修改",
                    "prompt_template": "修改 {{user_prompt}}",
                    "created_at": 50,
                    "updated_at": 60,
                }
            ],
            "system_instructions": [],
        }
        restored_catalog, restored = restore_builtin_prompt_catalog_item(
            catalog, defaults, "generation_prompts", "builtin", timestamp=100
        )
        self.assertEqual(restored["name"], "默认名称")
        self.assertEqual(restored["prompt_template"], "默认 {{user_prompt}}")
        self.assertEqual(restored["created_at"], 50)
        self.assertEqual(restored["updated_at"], 100)
        self.assertEqual(restored_catalog["generation_prompts"][0], restored)

        unchanged, missing = restore_builtin_prompt_catalog_item(
            catalog, defaults, "generation_prompts", "custom", timestamp=100
        )
        self.assertIs(unchanged, catalog)
        self.assertIsNone(missing)

        system_defaults = {
            "system_instructions": [{
                "id": "sys_builtin",
                "name": "默认指令",
                "system_template": "默认系统内容",
                "user_template": "处理 {{prompt}}",
            }]
        }
        system_catalog = {
            "generation_prompts": [],
            "system_instructions": [{
                "id": "sys_builtin",
                "name": "本地指令",
                "system_template": "本地系统内容",
                "user_template": "修改 {{prompt}}",
            }],
        }
        _, restored_system = restore_builtin_prompt_catalog_item(
            system_catalog, system_defaults, "system_instructions", "sys_builtin", timestamp=100
        )
        self.assertEqual(restored_system["name"], "默认指令")
        self.assertEqual(restored_system["system_template"], "默认系统内容")

    def test_missing_builtin_items_are_restored_without_overwriting_local_edits(self):
        defaults = {
            "generation_prompts": [
                {"id": "kept", "name": "默认名称", "prompt_template": "默认 {{user_prompt}}"},
                {"id": "missing", "name": "缺失内置", "prompt_template": "缺失 {{user_prompt}}"},
            ],
            "system_instructions": [],
        }
        catalog = {
            "generation_prompts": [
                {"id": "kept", "name": "用户修改", "prompt_template": "修改 {{user_prompt}}"}
            ],
            "system_instructions": [],
        }
        merged, added = merge_missing_prompt_catalog_builtins(catalog, defaults, timestamp=100)
        self.assertEqual(added, 1)
        self.assertEqual(merged["generation_prompts"][0]["name"], "用户修改")
        self.assertEqual(merged["generation_prompts"][1]["id"], "missing")

    def test_retired_panorama_builtin_is_removed_without_deleting_custom_content(self):
        retired = normalize_generation_prompt({
            "id": "equirectangular_panorama",
            "name": "360全景图",
            "category": "空间与机位",
            "description": "标准 2:1 无缝全景，用于 VR 预览",
            "icon": "gallery-horizontal-end",
            "prompt_template": "生成一张标准 2:1 等距柱状投影的 360 度全景图，完整覆盖水平方向一周以及从顶部到底部的垂直视野，可直接用于 VR 全景查看。\n\n用户对空间、环境和视觉风格的补充要求：\n{{user_prompt}}\n\n场景的建筑结构、道路、墙面、家具、光源和地平线必须具有连续且合理的空间关系。画面最左侧与最右侧表示同一个接缝位置，两侧的几何结构、纹理、光照和物体边缘必须自然衔接，循环查看时不能出现明显断层。顶部和底部极点保持自然，避免拉伸、扭曲或重复物体。封闭空间必须具有符合逻辑的入口或出口。画面中不添加文字、标识、水印、边框或全景预览界面。",
            "recommended_ratio": "2:1",
            "recommended_resolution": "4K",
        }, timestamp=100)
        edited = {**retired, "description": "用户修改后保留"}
        same_name_custom = {
            **retired,
            "id": "my_panorama",
            "prompt_template": "我的全景提示词 {{user_prompt}}",
        }
        catalog, removed = remove_retired_prompt_catalog_builtins({
            "generation_prompts": [retired, edited, same_name_custom],
            "system_instructions": [],
        })
        self.assertEqual(removed, 1)
        self.assertEqual(
            [item["id"] for item in catalog["generation_prompts"]],
            ["equirectangular_panorama", "my_panorama"],
        )
        self.assertEqual(catalog["generation_prompts"][0]["description"], "用户修改后保留")


if __name__ == "__main__":
    unittest.main()
