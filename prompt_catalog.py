import json
import os
import re
import tempfile
import time
import uuid


USER_PROMPT_TOKEN = "{{user_prompt}}"
PROMPT_CATALOG_VERSION = 1
REASONING_EFFORTS = {"", "low", "medium", "high"}
RATIO_RE = re.compile(r"^[1-9]\d*:[1-9]\d*$")
RESOLUTION_RE = re.compile(r"^(?:[1-9]\d*(?:\.\d+)?K|[1-9]\d{2,4}\s*[xX×]\s*[1-9]\d{2,4})$", re.I)
IDENTIFIER_RE = re.compile(r"[^A-Za-z0-9_-]+")


class PromptCatalogValidationError(ValueError):
    pass


def now_ms():
    return int(time.time() * 1000)


def default_prompt_catalog():
    return {
        "version": PROMPT_CATALOG_VERSION,
        "generation_prompts": [],
        "system_instructions": [],
        "updated_at": now_ms(),
    }


def normalize_identifier(value, prefix):
    value = IDENTIFIER_RE.sub("_", str(value or "")).strip("_")[:60]
    return value or f"{prefix}_{uuid.uuid4().hex[:12]}"


def normalize_text(value, limit=0):
    text = str(value or "").strip()
    return text[:limit] if limit else text


def normalize_ratio(value):
    ratio = re.sub(r"\s+", "", str(value or "").strip())
    if ratio and not RATIO_RE.fullmatch(ratio):
        raise PromptCatalogValidationError("推荐比例必须使用 16:9 这样的格式")
    return ratio


def normalize_resolution(value):
    resolution = str(value or "").strip().upper().replace("X", "×")
    resolution = re.sub(r"\s*×\s*", "×", resolution)
    if resolution and not RESOLUTION_RE.fullmatch(resolution):
        raise PromptCatalogValidationError("推荐分辨率必须使用 2K、4K 或 2048×2048 这样的格式")
    return resolution


def validate_generation_prompt(item):
    if not normalize_text(item.get("name")):
        raise PromptCatalogValidationError("生成提示词名称不能为空")
    template = normalize_text(item.get("prompt_template"))
    if not template:
        raise PromptCatalogValidationError("生成提示词模板不能为空")
    token_count = template.count(USER_PROMPT_TOKEN)
    if token_count != 1:
        raise PromptCatalogValidationError(
            f"生成提示词模板必须且只能包含一个 {USER_PROMPT_TOKEN}"
        )
    normalize_ratio(item.get("recommended_ratio"))
    normalize_resolution(item.get("recommended_resolution"))


def normalize_generation_prompt(item, *, timestamp=None):
    item = item if isinstance(item, dict) else {}
    validate_generation_prompt(item)
    current_time = int(timestamp or now_ms())
    created_at = int(item.get("created_at") or current_time)
    return {
        "id": normalize_identifier(item.get("id"), "gen"),
        "name": normalize_text(item.get("name"), 120),
        "category": normalize_text(item.get("category") or "未分类", 80),
        "description": normalize_text(item.get("description"), 500),
        "icon": normalize_text(item.get("icon"), 80),
        "prompt_template": normalize_text(item.get("prompt_template")),
        "recommended_ratio": normalize_ratio(item.get("recommended_ratio")),
        "recommended_resolution": normalize_resolution(item.get("recommended_resolution")),
        "created_at": created_at,
        "updated_at": int(item.get("updated_at") or created_at),
    }


def validate_system_instruction(item):
    if not normalize_text(item.get("name")):
        raise PromptCatalogValidationError("系统指令名称不能为空")
    if not normalize_text(item.get("system_template")):
        raise PromptCatalogValidationError("系统指令不能为空")
    user_template = normalize_text(item.get("user_template"))
    if not user_template:
        raise PromptCatalogValidationError("用户指令模板不能为空")
    if "{{prompt}}" not in user_template and "{{selection}}" not in user_template:
        raise PromptCatalogValidationError("用户指令模板必须包含 {{prompt}} 或 {{selection}}")
    effort = normalize_text(item.get("recommended_reasoning_effort"), 20)
    if effort not in REASONING_EFFORTS:
        raise PromptCatalogValidationError("推荐推理强度无效")


def normalize_system_instruction(item, *, timestamp=None):
    item = item if isinstance(item, dict) else {}
    validate_system_instruction(item)
    current_time = int(timestamp or now_ms())
    created_at = int(item.get("created_at") or current_time)
    return {
        "id": normalize_identifier(item.get("id"), "sys"),
        "name": normalize_text(item.get("name"), 120),
        "description": normalize_text(item.get("description"), 500),
        "system_template": normalize_text(item.get("system_template")),
        "user_template": normalize_text(item.get("user_template")),
        "preserve_references": bool(item.get("preserve_references", True)),
        "default_target_language": normalize_text(item.get("default_target_language"), 80),
        "recommended_reasoning_effort": normalize_text(item.get("recommended_reasoning_effort"), 20),
        "created_at": created_at,
        "updated_at": int(item.get("updated_at") or created_at),
    }


def _normalize_unique_items(items, normalizer):
    normalized = []
    seen = set()
    for raw_item in items if isinstance(items, list) else []:
        try:
            item = normalizer(raw_item)
        except (PromptCatalogValidationError, TypeError, ValueError):
            continue
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        normalized.append(item)
    return normalized


def normalize_prompt_catalog(data):
    data = data if isinstance(data, dict) else {}
    return {
        "version": PROMPT_CATALOG_VERSION,
        "generation_prompts": _normalize_unique_items(
            data.get("generation_prompts"), normalize_generation_prompt
        ),
        "system_instructions": _normalize_unique_items(
            data.get("system_instructions"), normalize_system_instruction
        ),
        "updated_at": int(data.get("updated_at") or now_ms()),
    }


def find_builtin_prompt_catalog_item(defaults, resource_key, item_id):
    defaults = defaults if isinstance(defaults, dict) else {}
    items = defaults.get(resource_key) if isinstance(defaults.get(resource_key), list) else []
    wanted = str(item_id or "")
    return next((item for item in items if str(item.get("id") or "") == wanted), None)


def mark_prompt_catalog_builtins(catalog, defaults):
    catalog = catalog if isinstance(catalog, dict) else default_prompt_catalog()
    defaults = defaults if isinstance(defaults, dict) else {}
    marked = {**catalog}
    for resource_key in ("generation_prompts", "system_instructions"):
        builtin_ids = {
            str(item.get("id") or "")
            for item in defaults.get(resource_key, [])
            if isinstance(item, dict) and str(item.get("id") or "")
        }
        marked[resource_key] = [
            {**item, "builtin": str(item.get("id") or "") in builtin_ids}
            for item in catalog.get(resource_key, [])
            if isinstance(item, dict)
        ]
    return marked


def merge_missing_prompt_catalog_builtins(catalog, defaults, *, timestamp=None):
    catalog = catalog if isinstance(catalog, dict) else default_prompt_catalog()
    defaults = defaults if isinstance(defaults, dict) else {}
    merged = {**catalog}
    added = 0
    current_time = int(timestamp or now_ms())
    for resource_key, normalizer in (
        ("generation_prompts", normalize_generation_prompt),
        ("system_instructions", normalize_system_instruction),
    ):
        items = list(catalog.get(resource_key, []))
        existing_ids = {str(item.get("id") or "") for item in items if isinstance(item, dict)}
        for default_item in defaults.get(resource_key, []):
            item_id = str(default_item.get("id") or "") if isinstance(default_item, dict) else ""
            if not item_id or item_id in existing_ids:
                continue
            items.append(normalizer({
                **default_item,
                "created_at": current_time,
                "updated_at": current_time,
            }, timestamp=current_time))
            existing_ids.add(item_id)
            added += 1
        merged[resource_key] = items
    return merged, added


def restore_builtin_prompt_catalog_item(catalog, defaults, resource_key, item_id, *, timestamp=None):
    default_item = find_builtin_prompt_catalog_item(defaults, resource_key, item_id)
    if not default_item:
        return catalog, None
    normalizer = normalize_generation_prompt if resource_key == "generation_prompts" else normalize_system_instruction
    items = list(catalog.get(resource_key, []) if isinstance(catalog, dict) else [])
    index = next((index for index, item in enumerate(items) if item.get("id") == item_id), -1)
    current_time = int(timestamp or now_ms())
    restored = normalizer({
        **default_item,
        "created_at": items[index].get("created_at") if index >= 0 else current_time,
        "updated_at": current_time,
    }, timestamp=current_time)
    if index >= 0:
        items[index] = restored
    else:
        items.append(restored)
    next_catalog = {
        **(catalog if isinstance(catalog, dict) else default_prompt_catalog()),
        resource_key: items,
    }
    return next_catalog, restored


def load_prompt_catalog(path, defaults=None):
    if not os.path.exists(path):
        return save_prompt_catalog(path, defaults if isinstance(defaults, dict) else default_prompt_catalog())
    try:
        with open(path, "r", encoding="utf-8") as file:
            raw_data = json.load(file)
    except (OSError, json.JSONDecodeError):
        raw_data = default_prompt_catalog()
    normalized = normalize_prompt_catalog(raw_data)
    if normalized != raw_data:
        return save_prompt_catalog(path, normalized)
    return normalized


def save_prompt_catalog(path, data):
    normalized = normalize_prompt_catalog(data)
    normalized["updated_at"] = now_ms()
    target_dir = os.path.dirname(os.path.abspath(path))
    os.makedirs(target_dir, exist_ok=True)
    descriptor, temp_path = tempfile.mkstemp(prefix="prompt_catalog_", suffix=".json", dir=target_dir)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            json.dump(normalized, file, ensure_ascii=False, indent=2)
            file.write("\n")
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
    return normalized
