export const USER_PROMPT_TOKEN = '{{user_prompt}}';

export function validateGenerationPromptTemplate(template){
  const value = String(template || '').trim();
  if(!value) return {valid:false, error:'生成提示词模板不能为空'};
  const tokenCount = value.split(USER_PROMPT_TOKEN).length - 1;
  if(tokenCount !== 1){
    return {valid:false, error:`生成提示词模板必须且只能包含一个 ${USER_PROMPT_TOKEN}`};
  }
  return {valid:true, error:''};
}

export function compileGenerationPrompt(template, userPrompt=''){
  const validation = validateGenerationPromptTemplate(template);
  if(!validation.valid) throw new Error(validation.error);
  const supplement = String(userPrompt || '').trim() || '没有额外修改要求。';
  return String(template).replace(USER_PROMPT_TOKEN, supplement).trim();
}

export function normalizeRecommendedRatio(value){
  const ratio = String(value || '').replace(/\s+/g, '');
  if(ratio && !/^[1-9]\d*:[1-9]\d*$/.test(ratio)){
    throw new Error('推荐比例必须使用 16:9 这样的格式');
  }
  return ratio;
}

export function normalizeRecommendedResolution(value){
  const resolution = String(value || '').trim().toUpperCase().replace(/X/g, '×').replace(/\s*×\s*/g, '×');
  if(resolution && !/^(?:[1-9]\d*(?:\.\d+)?K|[1-9]\d{2,4}×[1-9]\d{2,4})$/i.test(resolution)){
    throw new Error('推荐分辨率必须使用 2K、4K 或 2048×2048 这样的格式');
  }
  return resolution;
}

const RATIO_SETTING_MAP = Object.freeze({
  '1:1':'square',
  '2:3':'portrait',
  '3:2':'landscape',
  '3:4':'portrait43',
  '4:3':'landscape43',
  '9:16':'story',
  '16:9':'wide',
  '21:9':'ultrawide',
  '9:21':'ultratall'
});

export function generationPromptSnapshot(item){
  if(!item || typeof item !== 'object') return null;
  const promptTemplate = String(item.prompt_template || '').trim();
  if(!validateGenerationPromptTemplate(promptTemplate).valid) return null;
  return {
    id:String(item.id || '').trim(),
    name:String(item.name || '').trim(),
    category:String(item.category || '').trim(),
    description:String(item.description || '').trim(),
    icon:String(item.icon || '').trim(),
    prompt_template:promptTemplate,
    recommended_ratio:normalizeRecommendedRatio(item.recommended_ratio || ''),
    recommended_resolution:normalizeRecommendedResolution(item.recommended_resolution || '')
  };
}

export function compileGenerationPromptSnapshot(snapshot, userPrompt=''){
  if(!snapshot?.prompt_template) return String(userPrompt || '').trim();
  return compileGenerationPrompt(snapshot.prompt_template, userPrompt);
}

export function smartRatioSetting(value){
  const ratio = normalizeRecommendedRatio(value || '');
  if(!ratio) return null;
  const mapped = RATIO_SETTING_MAP[ratio];
  if(mapped) return {ratio:mapped, customRatio:''};
  return {ratio:'custom', customRatio:ratio};
}

export function smartResolutionSetting(value){
  const resolution = normalizeRecommendedResolution(value || '');
  if(!resolution) return null;
  const tier = resolution.match(/^([1-9]\d*(?:\.\d+)?)K$/i);
  if(tier) return {resolution:`${tier[1]}k`.toLowerCase(), customSize:''};
  return {resolution:'custom', customSize:resolution.replace('×', 'x')};
}

export function applyGenerationPromptRecommendations(sourceSettings={}, snapshot=null){
  const next = {...(sourceSettings || {})};
  const ratio = smartRatioSetting(snapshot?.recommended_ratio || '');
  const resolution = smartResolutionSetting(snapshot?.recommended_resolution || '');
  if(ratio) Object.assign(next, ratio);
  if(resolution) Object.assign(next, resolution);
  return next;
}
