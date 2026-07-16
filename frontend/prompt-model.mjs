export const PROMPT_CLIPBOARD_MIME = 'application/x-infinite-canvas-prompt+json';

export function normalizeReferenceKind(value){
  const kind = String(value || '').trim().toLowerCase();
  if(kind === 'video' || kind === 'audio') return kind;
  return 'image';
}

function stableHash(value){
  let hash = 2166136261;
  const text = String(value || '');
  for(let i = 0; i < text.length; i += 1){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function referenceIdentity(ref={}){
  const kind = normalizeReferenceKind(ref.kind);
  const mediaId = String(ref.mediaId || ref.media_id || '').trim();
  if(mediaId) return `${kind}|media|${mediaId}`;
  const assetId = String(ref.assetId || ref.asset_id || ref.id || '').trim();
  if(assetId) return `${kind}|asset|${assetId}`;
  const url = String(ref.url || '').trim();
  if(url) return `${kind}|url|${url}`;
  return `${kind}|node|${String(ref.nodeId || '')}|${String(ref.imageIndex ?? '')}|${String(ref.name || '')}`;
}

export function createReferenceId(ref={}, usedIds=new Set()){
  const preferred = String(ref.refId || ref.ref_id || '').trim();
  const base = preferred || `ref_${stableHash(referenceIdentity(ref))}`;
  let id = base;
  let suffix = 2;
  while(usedIds.has(id)) id = `${base}_${suffix++}`;
  return id;
}

export function normalizeReference(ref={}, usedIds=new Set()){
  const kind = normalizeReferenceKind(ref.kind);
  const normalized = {
    ...ref,
    refId:createReferenceId(ref, usedIds),
    mediaId:String(ref.mediaId || ref.media_id || ''),
    kind,
    url:String(ref.url || ''),
    name:String(ref.name || ref.alias || (kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片')),
    nodeId:String(ref.nodeId || ''),
    imageIndex:Number.isFinite(Number(ref.imageIndex)) ? Number(ref.imageIndex) : '',
    asset_uris:(ref.asset_uris && typeof ref.asset_uris === 'object') ? {...ref.asset_uris} : {}
  };
  delete normalized.ref_id;
  delete normalized.media_id;
  return normalized;
}

export function mergeReferenceLists(...lists){
  const result = [];
  const identities = new Set();
  const ids = new Set();
  lists.flat().filter(Boolean).forEach(raw => {
    const identity = referenceIdentity(raw);
    if(identities.has(identity)) return;
    const ref = normalizeReference(raw, ids);
    identities.add(identity);
    ids.add(ref.refId);
    result.push(ref);
  });
  return result;
}

export function referenceLabel(ref, orderedReferences=[]){
  const targetIdentity = referenceIdentity(ref);
  const counters = {image:0, video:0, audio:0};
  let fallback = '';
  for(const item of orderedReferences){
    const kind = normalizeReferenceKind(item.kind);
    counters[kind] += 1;
    const label = kind === 'video' ? `视频${counters[kind]}` : kind === 'audio' ? `音频${counters[kind]}` : `图${counters[kind]}`;
    if(!fallback && String(item.refId || '') === String(ref.refId || '')) fallback = label;
    if(referenceIdentity(item) === targetIdentity) return label;
  }
  const kind = normalizeReferenceKind(ref.kind);
  return fallback || (kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片');
}

export function referencePlaceholder(ref, orderedReferences=[]){
  const targetIdentity = referenceIdentity(ref);
  const counters = {image:0, video:0, audio:0};
  for(const item of orderedReferences){
    const kind = normalizeReferenceKind(item.kind);
    counters[kind] += 1;
    if(referenceIdentity(item) !== targetIdentity && String(item.refId || '') !== String(ref.refId || '')) continue;
    const type = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Image';
    return `{{${type} ${counters[kind]}}}`;
  }
  const kind = normalizeReferenceKind(ref.kind);
  const type = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Image';
  return `{{${type} 1}}`;
}

export function emptyPromptDocument(){
  return {type:'doc', content:[{type:'paragraph'}]};
}

function referenceForPlaceholder(type, index, references){
  const expectedKind = String(type || '').toLowerCase() === 'video'
    ? 'video'
    : String(type || '').toLowerCase() === 'audio' ? 'audio' : 'image';
  return references.filter(ref => normalizeReferenceKind(ref.kind) === expectedKind)[Math.max(0, Number(index) - 1)] || null;
}

export function parsePromptTextSegments(text, orderedReferences=[]){
  const value = String(text || '');
  const pattern = /\{\{\s*(Image|Video|Audio)\s+(\d+)\s*\}\}/gi;
  const segments = [];
  let cursor = 0;
  let match;
  while((match = pattern.exec(value))){
    if(match.index > cursor) segments.push({type:'text', text:value.slice(cursor, match.index)});
    const ref = referenceForPlaceholder(match[1], match[2], orderedReferences);
    if(ref) segments.push({type:'reference', refId:ref.refId});
    else segments.push({type:'text', text:match[0], unresolved:true});
    cursor = pattern.lastIndex;
  }
  if(cursor < value.length) segments.push({type:'text', text:value.slice(cursor)});
  return segments;
}

export function textToPromptDocument(text, orderedReferences=[]){
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  return {
    type:'doc',
    content:lines.map(line => {
      const content = parsePromptTextSegments(line, orderedReferences).flatMap(segment => {
        if(segment.type === 'reference') return [{type:'media_reference', attrs:{refId:segment.refId}}];
        return segment.text ? [{type:'text', text:segment.text}] : [];
      });
      return content.length ? {type:'paragraph', content} : {type:'paragraph'};
    })
  };
}

function referenceMap(references=[]){
  return new Map(references.map(ref => [String(ref.refId || ''), ref]));
}

export function promptDocumentParts(docJson, references=[]){
  const refs = referenceMap(references);
  const parts = [];
  const appendText = text => {
    if(!text) return;
    const last = parts[parts.length - 1];
    if(last?.type === 'text') last.text += text;
    else parts.push({type:'text', text});
  };
  const blocks = Array.isArray(docJson?.content) ? docJson.content : [];
  blocks.forEach((block, blockIndex) => {
    if(blockIndex) appendText('\n');
    (block?.content || []).forEach(node => {
      if(node.type === 'text') appendText(node.text || '');
      else if(node.type === 'hard_break') appendText('\n');
      else if(node.type === 'media_reference'){
        const ref = refs.get(String(node.attrs?.refId || ''));
        if(ref) parts.push({type:'image', ...ref});
      }
    });
  });
  return parts;
}

export function promptDocumentExchangeText(docJson, references=[], orderedReferences=references){
  return promptDocumentParts(docJson, references).map(part => {
    if(part.type === 'text') return part.text || '';
    return referencePlaceholder(part, orderedReferences);
  }).join('');
}

export function usedPromptReferenceIds(docJson){
  const ids = new Set();
  const walk = node => {
    if(node?.type === 'media_reference' && node.attrs?.refId) ids.add(String(node.attrs.refId));
    (node?.content || []).forEach(walk);
  };
  walk(docJson || {});
  return ids;
}

export function prunePromptReferences(docJson, references=[]){
  const used = usedPromptReferenceIds(docJson);
  return references.filter(ref => used.has(String(ref.refId || '')));
}
