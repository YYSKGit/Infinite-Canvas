var GenerationPromptModel = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // frontend/generation-prompt-model.mjs
  var generation_prompt_model_exports = {};
  __export(generation_prompt_model_exports, {
    USER_PROMPT_TOKEN: () => USER_PROMPT_TOKEN,
    applyGenerationPromptRecommendations: () => applyGenerationPromptRecommendations,
    compileGenerationPrompt: () => compileGenerationPrompt,
    compileGenerationPromptSnapshot: () => compileGenerationPromptSnapshot,
    generationPromptSnapshot: () => generationPromptSnapshot,
    normalizeRecommendedRatio: () => normalizeRecommendedRatio,
    normalizeRecommendedResolution: () => normalizeRecommendedResolution,
    smartRatioSetting: () => smartRatioSetting,
    smartResolutionSetting: () => smartResolutionSetting,
    validateGenerationPromptTemplate: () => validateGenerationPromptTemplate
  });
  var USER_PROMPT_TOKEN = "{{user_prompt}}";
  function validateGenerationPromptTemplate(template) {
    const value = String(template || "").trim();
    if (!value) return { valid: false, error: "\u751F\u6210\u63D0\u793A\u8BCD\u6A21\u677F\u4E0D\u80FD\u4E3A\u7A7A" };
    const tokenCount = value.split(USER_PROMPT_TOKEN).length - 1;
    if (tokenCount !== 1) {
      return { valid: false, error: `\u751F\u6210\u63D0\u793A\u8BCD\u6A21\u677F\u5FC5\u987B\u4E14\u53EA\u80FD\u5305\u542B\u4E00\u4E2A ${USER_PROMPT_TOKEN}` };
    }
    return { valid: true, error: "" };
  }
  function compileGenerationPrompt(template, userPrompt = "") {
    const validation = validateGenerationPromptTemplate(template);
    if (!validation.valid) throw new Error(validation.error);
    const supplement = String(userPrompt || "").trim() || "\u6CA1\u6709\u989D\u5916\u4FEE\u6539\u8981\u6C42\u3002";
    return String(template).replace(USER_PROMPT_TOKEN, supplement).trim();
  }
  function normalizeRecommendedRatio(value) {
    const ratio = String(value || "").replace(/\s+/g, "");
    if (ratio && !/^[1-9]\d*:[1-9]\d*$/.test(ratio)) {
      throw new Error("\u63A8\u8350\u6BD4\u4F8B\u5FC5\u987B\u4F7F\u7528 16:9 \u8FD9\u6837\u7684\u683C\u5F0F");
    }
    return ratio;
  }
  function normalizeRecommendedResolution(value) {
    const resolution = String(value || "").trim().toUpperCase().replace(/X/g, "\xD7").replace(/\s*×\s*/g, "\xD7");
    if (resolution && !/^(?:[1-9]\d*(?:\.\d+)?K|[1-9]\d{2,4}×[1-9]\d{2,4})$/i.test(resolution)) {
      throw new Error("\u63A8\u8350\u5206\u8FA8\u7387\u5FC5\u987B\u4F7F\u7528 2K\u30014K \u6216 2048\xD72048 \u8FD9\u6837\u7684\u683C\u5F0F");
    }
    return resolution;
  }
  var RATIO_SETTING_MAP = Object.freeze({
    "1:1": "square",
    "2:3": "portrait",
    "3:2": "landscape",
    "3:4": "portrait43",
    "4:3": "landscape43",
    "9:16": "story",
    "16:9": "wide",
    "21:9": "ultrawide",
    "9:21": "ultratall"
  });
  function generationPromptSnapshot(item) {
    if (!item || typeof item !== "object") return null;
    const promptTemplate = String(item.prompt_template || "").trim();
    if (!validateGenerationPromptTemplate(promptTemplate).valid) return null;
    return {
      id: String(item.id || "").trim(),
      name: String(item.name || "").trim(),
      category: String(item.category || "").trim(),
      description: String(item.description || "").trim(),
      icon: String(item.icon || "").trim(),
      prompt_template: promptTemplate,
      recommended_ratio: normalizeRecommendedRatio(item.recommended_ratio || ""),
      recommended_resolution: normalizeRecommendedResolution(item.recommended_resolution || "")
    };
  }
  function compileGenerationPromptSnapshot(snapshot, userPrompt = "") {
    if (!snapshot?.prompt_template) return String(userPrompt || "").trim();
    return compileGenerationPrompt(snapshot.prompt_template, userPrompt);
  }
  function smartRatioSetting(value) {
    const ratio = normalizeRecommendedRatio(value || "");
    if (!ratio) return null;
    const mapped = RATIO_SETTING_MAP[ratio];
    if (mapped) return { ratio: mapped, customRatio: "" };
    return { ratio: "custom", customRatio: ratio };
  }
  function smartResolutionSetting(value) {
    const resolution = normalizeRecommendedResolution(value || "");
    if (!resolution) return null;
    const tier = resolution.match(/^([1-9]\d*(?:\.\d+)?)K$/i);
    if (tier) return { resolution: `${tier[1]}k`.toLowerCase(), customSize: "" };
    return { resolution: "custom", customSize: resolution.replace("\xD7", "x") };
  }
  function applyGenerationPromptRecommendations(sourceSettings = {}, snapshot = null) {
    const next = { ...sourceSettings || {} };
    const ratio = smartRatioSetting(snapshot?.recommended_ratio || "");
    const resolution = smartResolutionSetting(snapshot?.recommended_resolution || "");
    if (ratio) Object.assign(next, ratio);
    if (resolution) Object.assign(next, resolution);
    return next;
  }
  return __toCommonJS(generation_prompt_model_exports);
})();
