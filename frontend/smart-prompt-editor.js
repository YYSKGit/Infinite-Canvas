import {Schema, Slice, DOMSerializer} from 'prosemirror-model';
import {EditorState, TextSelection} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';
import {history, undo, redo} from 'prosemirror-history';
import {keymap} from 'prosemirror-keymap';
import {baseKeymap} from 'prosemirror-commands';
import {plainCaretCoords} from './prompt-geometry.mjs';
import {
  PROMPT_CLIPBOARD_MIME,
  createReferenceId,
  emptyPromptDocument,
  mergeReferenceLists,
  normalizeReference,
  promptDocumentExchangeText,
  promptDocumentParts,
  prunePromptReferences,
  referenceIdentity,
  referenceLabel,
  referencePlaceholder,
  textToPromptDocument
} from './prompt-model.mjs';

const schema = new Schema({
  nodes:{
    doc:{content:'paragraph*'},
    paragraph:{content:'inline*', group:'block', toDOM:() => ['p', 0], parseDOM:[{tag:'p'}, {tag:'div'}]},
    text:{group:'inline'},
    hard_break:{inline:true, group:'inline', selectable:false, toDOM:() => ['br'], parseDOM:[{tag:'br'}]},
    media_reference:{
      inline:true,
      group:'inline',
      atom:true,
      selectable:false,
      attrs:{refId:{}},
      toDOM:node => ['span', {'data-prompt-ref-id':node.attrs.refId, 'data-prompt-ref':'1'}],
      parseDOM:[{tag:'span[data-prompt-ref-id]', getAttrs:dom => ({refId:dom.getAttribute('data-prompt-ref-id') || ''})}]
    }
  }
});

function cloneJson(value){
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function escapeHtml(value){
  return String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function inlineNeighborNeedsSpace(node, edge){
  if(!node || node.type === schema.nodes.hard_break) return false;
  if(!node.isText) return true;
  const text = node.text || '';
  const character = edge === 'left' ? text.at(-1) : text[0];
  return Boolean(character && !/\s/u.test(character));
}

function sliceReferenceIds(slice){
  const ids = new Set();
  slice.content.descendants(node => {
    if(node.type.name === 'media_reference' && node.attrs.refId) ids.add(String(node.attrs.refId));
  });
  return ids;
}

function remapSliceJson(sliceJson, mapping){
  const copy = cloneJson(sliceJson);
  const walk = node => {
    if(node?.type === 'media_reference' && node.attrs?.refId && mapping[node.attrs.refId]) node.attrs.refId = mapping[node.attrs.refId];
    (node?.content || []).forEach(walk);
  };
  (copy?.content || []).forEach(walk);
  return copy;
}

class MediaReferenceView {
  constructor(node, editor, getPos){
    this.editor = editor;
    this.node = node;
    this.getPos = getPos;
    this.dom = document.createElement('span');
    this.dom.className = 'mention-image-token prompt-reference-token';
    this.dom.contentEditable = 'false';
    this.dom.setAttribute('role', 'button');
    this.dom.setAttribute('aria-label', '媒体引用');
    this.render();
    this.dom.addEventListener('pointerdown', event => {
      if(event.button !== 0) return;
      event.preventDefault();
      this.editor.beginPointerReferenceDrag(this.dom, this.getPos, event);
    });
  }

  render(){
    this.editor.renderReferenceToken(this.dom, String(this.node.attrs.refId || ''));
  }

  update(node){
    if(node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(){ return true; }
  stopEvent(){ return false; }
}

export class SmartPromptEditor {
  constructor(host){
    if(!host) throw new Error('SmartPromptEditor requires a host element');
    this.host = host;
    this.references = [];
    this.referenceArchive = [];
    this.referenceContext = [];
    this.dragTargetPos = null;
    this.dragCaretElement = null;
    this.selectionCaretElement = null;
    this.selectionCaretFrame = 0;
    this.selectionCaretPosition = null;
    this.caretResizeObserver = null;
    this.referenceDragActive = false;
    this.destroyed = false;
    this.silent = 0;
    this.locked = false;
    this.view = new EditorView(host, {
      state:this.createState(emptyPromptDocument()),
      dispatchTransaction:transaction => {
        const previousDoc = this.view.state.doc;
        const next = this.view.state.apply(transaction);
        this.view.updateState(next);
        this.scheduleSelectionCaretSync();
        if(!next.doc.eq(previousDoc)){
          this.referenceArchive = mergeReferenceLists(this.referenceArchive, this.references);
          this.references = prunePromptReferences(next.doc.toJSON(), mergeReferenceLists(this.references, this.referenceArchive));
          this.syncReferenceTokens();
          this.emitChange();
        }
      },
      editable:() => !this.locked,
      attributes:{class:'smart-prompt-editor-content', spellcheck:'true'},
      nodeViews:{media_reference:(node, _view, getPos) => new MediaReferenceView(node, this, getPos)},
      handleDOMEvents:{
        copy:(view, event) => this.handleCopyCut(view, event, false),
        cut:(view, event) => this.handleCopyCut(view, event, true),
        focus:() => { this.scheduleSelectionCaretSync(); return false; },
        blur:() => { this.clearSelectionCaret(); return false; }
      },
      handlePaste:(view, event) => this.handlePaste(view, event)
    });
    host.classList.add('smart-prompt-editor-host');
    if(typeof ResizeObserver === 'function'){
      this.caretResizeObserver = new ResizeObserver(() => this.scheduleSelectionCaretSync());
      this.caretResizeObserver.observe(host);
      this.caretResizeObserver.observe(this.view.dom);
    }
    this.syncEmptyState();
  }

  createState(docJson){
    let doc;
    try { doc = schema.nodeFromJSON(docJson || emptyPromptDocument()); }
    catch(_) { doc = schema.nodeFromJSON(emptyPromptDocument()); }
    return EditorState.create({
      schema,
      doc,
      plugins:[
        history(),
        keymap({'Mod-z':undo, 'Mod-y':redo, 'Mod-Shift-z':redo}),
        keymap(baseKeymap)
      ]
    });
  }

  caretOverlayGeometry(position, lineHint=null, xHint=null){
    let coords;
    try { coords = plainCaretCoords(this.view.coordsAtPos(position)); }
    catch(_) { return null; }
    if(!coords) return null;
    if(lineHint && Number.isFinite(xHint)){
      const candidates = [];
      [-1, 1].forEach(side => {
        try {
          const candidate = plainCaretCoords(this.view.coordsAtPos(position, side));
          if(!candidate) return;
          const overlap = Math.min(candidate.bottom, lineHint.bottom) - Math.max(candidate.top, lineHint.top);
          candidates.push({candidate, overlap});
        } catch(_) {}
      });
      const onLine = candidates.filter(item => item.overlap > 0);
      const pool = onLine.length ? onLine : candidates;
      pool.sort((a, b) => Math.abs(a.candidate.left - xHint) - Math.abs(b.candidate.left - xHint));
      if(pool[0]) coords = pool[0].candidate;
    }
    const hostRect = this.host.getBoundingClientRect();
    const scaleX = this.host.offsetWidth ? hostRect.width / this.host.offsetWidth : 1;
    const scaleY = this.host.offsetHeight ? hostRect.height / this.host.offsetHeight : scaleX;
    let anchorCoords = lineHint
      ? {...coords, top:lineHint.top, bottom:lineHint.bottom}
      : coords;
    let textCaretCoords = null;
    try {
      const $position = this.view.state.doc.resolve(position);
      if($position.parent.isTextblock){
        const media = schema.nodes.media_reference;
        const beforeMedia = $position.nodeBefore?.type === media ? $position.nodeBefore : null;
        const afterMedia = $position.nodeAfter?.type === media ? $position.nodeAfter : null;
        const hasTextNeighbor = $position.nodeBefore?.isText || $position.nodeAfter?.isText;
        const tokenBoundary = (node, nodePosition, edge) => {
          if(!node) return null;
          const dom = this.view.nodeDOM(nodePosition);
          if(!dom?.getBoundingClientRect) return null;
          const rect = dom.getBoundingClientRect();
          const tokenStyle = window.getComputedStyle(dom);
          const margin = parseFloat(edge === 'after' ? tokenStyle.marginRight : tokenStyle.marginLeft) || 0;
          return {
            left:edge === 'after' ? rect.right + margin * scaleX : rect.left - margin * scaleX,
            top:rect.top,
            bottom:rect.bottom
          };
        };
        if(!hasTextNeighbor && (beforeMedia || afterMedia)){
          const beforeBoundary = tokenBoundary(beforeMedia, position - (beforeMedia?.nodeSize || 0), 'after');
          const afterBoundary = tokenBoundary(afterMedia, position, 'before');
          if(beforeBoundary && afterBoundary){
            const overlap = Math.min(beforeBoundary.bottom, afterBoundary.bottom)
              - Math.max(beforeBoundary.top, afterBoundary.top);
            if(overlap > 0){
              anchorCoords = {
                left:(beforeBoundary.left + afterBoundary.left) / 2,
                right:(beforeBoundary.left + afterBoundary.left) / 2,
                top:Math.min(beforeBoundary.top, afterBoundary.top),
                bottom:Math.max(beforeBoundary.bottom, afterBoundary.bottom)
              };
            } else {
              const rawCenter = (coords.top + coords.bottom) / 2;
              const beforeDistance = Math.abs((beforeBoundary.top + beforeBoundary.bottom) / 2 - rawCenter);
              const afterDistance = Math.abs((afterBoundary.top + afterBoundary.bottom) / 2 - rawCenter);
              const chosen = beforeDistance <= afterDistance ? beforeBoundary : afterBoundary;
              anchorCoords = {...chosen, right:chosen.left};
            }
          } else {
            const chosen = beforeBoundary || afterBoundary;
            if(chosen) anchorCoords = {...chosen, right:chosen.left};
          }
        }
        const parentStart = $position.start();
        const currentCenterY = (anchorCoords.top + anchorCoords.bottom) / 2;
        let bestScore = Infinity;
        $position.parent.forEach((child, offset) => {
          if(!child.isText || !child.text) return;
          const start = parentStart + offset;
          const end = start + child.nodeSize;
          [[start, 1], [end, -1]].forEach(([candidatePosition, side]) => {
            let candidate;
            try { candidate = this.view.coordsAtPos(candidatePosition, side); }
            catch(_) { return; }
            const height = candidate.bottom - candidate.top;
            const overlap = Math.min(candidate.bottom, anchorCoords.bottom) - Math.max(candidate.top, anchorCoords.top);
            if(height <= 0 || overlap <= 0) return;
            const candidateCenterY = (candidate.top + candidate.bottom) / 2;
            const centerDistance = Math.abs(candidateCenterY - currentCenterY);
            if(centerDistance > Math.max(2, height * .65)) return;
            const score = centerDistance * 10000
              + Math.abs(candidatePosition - position);
            if(score < bestScore){
              bestScore = score;
              textCaretCoords = candidate;
            }
          });
        });
      }
    } catch(_) {}
    const style = window.getComputedStyle(this.view.dom);
    const fontSize = parseFloat(style.fontSize) || 16;
    const fallbackHeight = (fontSize + 2) * Math.max(.1, scaleY);
    const caretTop = textCaretCoords?.top ?? ((anchorCoords.top + anchorCoords.bottom - fallbackHeight) / 2);
    const caretHeight = textCaretCoords ? textCaretCoords.bottom - textCaretCoords.top : fallbackHeight;
    const contentLeft = hostRect.left + this.host.clientLeft * scaleX;
    const contentTop = hostRect.top + this.host.clientTop * scaleY;
    const computedCaretColor = String(style.caretColor || '').trim();
    const transparentCaret = !computedCaretColor || computedCaretColor === 'auto'
      || computedCaretColor === 'transparent' || computedCaretColor === 'rgba(0, 0, 0, 0)';
    return {
      left:(anchorCoords.left - contentLeft) / Math.max(.1, scaleX) + this.host.scrollLeft,
      top:(caretTop - contentTop) / Math.max(.1, scaleY) + this.host.scrollTop,
      height:Math.max(12, caretHeight / Math.max(.1, scaleY)),
      color:transparentCaret ? style.color : computedCaretColor,
      viewportLeft:anchorCoords.left,
      viewportTop:caretTop,
      viewportBottom:caretTop + caretHeight,
      hitTop:anchorCoords.top,
      hitBottom:anchorCoords.bottom,
      scaleX,
      scaleY
    };
  }

  scheduleSelectionCaretSync(){
    if(this.destroyed || this.selectionCaretFrame) return;
    this.selectionCaretFrame = window.requestAnimationFrame(() => {
      this.selectionCaretFrame = 0;
      this.syncSelectionCaret();
    });
  }

  syncSelectionCaret(){
    if(this.destroyed || !this.view?.dom?.isConnected || this.locked || !this.view.hasFocus()){
      this.clearSelectionCaret();
      return;
    }
    if(this.referenceDragActive){
      this.clearSelectionCaret({keepNativeHidden:true});
      return;
    }
    const {selection} = this.view.state;
    const media = schema.nodes.media_reference;
    const besideMedia = selection.empty && selection.$from.parent.isTextblock
      && (selection.$from.nodeBefore?.type === media || selection.$from.nodeAfter?.type === media);
    if(!besideMedia){
      this.clearSelectionCaret();
      return;
    }
    const geometry = this.caretOverlayGeometry(selection.from);
    if(!geometry){
      this.clearSelectionCaret();
      return;
    }
    if(this.selectionCaretPosition !== selection.from){
      this.selectionCaretElement?.remove();
      this.selectionCaretElement = null;
    }
    if(!this.selectionCaretElement){
      this.selectionCaretElement = document.createElement('span');
      this.selectionCaretElement.className = 'prompt-selection-caret prompt-caret-overlay';
      this.selectionCaretElement.setAttribute('aria-hidden', 'true');
      this.host.appendChild(this.selectionCaretElement);
    }
    this.selectionCaretPosition = selection.from;
    this.view.dom.classList.add('smart-prompt-native-caret-hidden');
    Object.assign(this.selectionCaretElement.style, {
      left:`${geometry.left}px`,
      top:`${geometry.top}px`,
      height:`${geometry.height}px`,
      backgroundColor:geometry.color
    });
  }

  clearSelectionCaret(options={}){
    if(this.selectionCaretFrame){
      window.cancelAnimationFrame(this.selectionCaretFrame);
      this.selectionCaretFrame = 0;
    }
    this.selectionCaretElement?.remove();
    this.selectionCaretElement = null;
    this.selectionCaretPosition = null;
    if(!options.keepNativeHidden) this.view?.dom?.classList.remove('smart-prompt-native-caret-hidden');
    else this.view?.dom?.classList.add('smart-prompt-native-caret-hidden');
  }

  emitChange(){
    this.syncEmptyState();
    if(this.silent) return;
    this.host.dispatchEvent(new CustomEvent('smart-prompt-change', {bubbles:true, detail:this.snapshot()}));
  }

  snapshot(){
    return {doc:this.getJSON(), references:this.getReferences(), text:this.getExchangeText()};
  }

  getJSON(){ return cloneJson(this.view.state.doc.toJSON()); }
  getReferences(){ return cloneJson(this.references); }
  getParts(){ return promptDocumentParts(this.getJSON(), this.references); }
  getExchangeText(){ return promptDocumentExchangeText(this.getJSON(), this.references, this.displayReferences()); }
  getSelectionRange(){
    const {from, to, empty} = this.view.state.selection;
    return {from, to, empty};
  }
  getSelectionExchangeText(){
    const selection = this.view.state.selection;
    if(selection.empty) return '';
    const content = selection.content().content.toJSON();
    return promptDocumentExchangeText({type:'doc', content}, this.references, this.displayReferences());
  }
  isEmpty(){ return this.view.state.doc.textContent.length === 0 && this.getParts().every(part => part.type === 'text' && !part.text); }
  hasFocus(){ return this.view.hasFocus(); }

  displayReferences(){
    const orderedContext = this.referenceContext.map(contextRef => {
      const owned = this.references.find(ref => referenceIdentity(ref) === referenceIdentity(contextRef));
      return owned ? {...contextRef, ...owned, refId:owned.refId} : contextRef;
    });
    return mergeReferenceLists(orderedContext, this.references);
  }

  setValue(docJson, references=[], options={}){
    this.silent += 1;
    try {
      this.references = mergeReferenceLists(references);
      this.referenceArchive = mergeReferenceLists(references);
      this.view.updateState(this.createState(docJson || emptyPromptDocument()));
      this.references = prunePromptReferences(this.getJSON(), this.references);
      this.syncReferenceTokens();
      this.syncEmptyState();
      this.scheduleSelectionCaretSync();
    } finally { this.silent -= 1; }
    if(!options.silent) this.emitChange();
  }

  setText(text, options={}){
    const ordered = this.displayReferences();
    const doc = textToPromptDocument(String(text || ''), ordered);
    const usedIds = new Set();
    const walk = node => {
      if(node?.type === 'media_reference' && node.attrs?.refId) usedIds.add(String(node.attrs.refId));
      (node?.content || []).forEach(walk);
    };
    walk(doc);
    const promoted = ordered.filter(ref => usedIds.has(String(ref.refId || '')));
    this.setValue(doc, mergeReferenceLists(this.references, promoted), options);
  }

  clear(options={}){ this.setValue(emptyPromptDocument(), [], options); }

  replaceText(text, options={}){
    const mode = options.mode || 'document';
    const ordered = this.displayReferences();
    const docJson = textToPromptDocument(String(text || ''), ordered);
    const replacement = schema.nodeFromJSON(docJson);
    this.referenceArchive = mergeReferenceLists(this.referenceArchive, this.references, ordered);
    let transaction = this.view.state.tr;
    if(mode === 'selection'){
      const range = options.range;
      if(range && Number.isFinite(range.from) && Number.isFinite(range.to)){
        const from = Math.max(0, Math.min(transaction.doc.content.size, Number(range.from)));
        const to = Math.max(from, Math.min(transaction.doc.content.size, Number(range.to)));
        transaction = transaction.setSelection(TextSelection.create(transaction.doc, from, to));
      }
      transaction = transaction.replaceSelection(new Slice(replacement.content, 0, 0));
    } else if(mode === 'cursor'){
      const pos = this.view.state.selection.from;
      transaction = transaction.replace(pos, pos, new Slice(replacement.content, 0, 0));
    } else if(mode === 'append'){
      const end = this.view.state.doc.content.size;
      transaction = transaction.replace(end, end, new Slice(replacement.content, 0, 0));
    } else {
      transaction = transaction.replaceWith(0, this.view.state.doc.content.size, replacement.content);
    }
    this.view.dispatch(transaction.scrollIntoView());
    if(options.focus !== false) this.view.focus();
    return this.snapshot();
  }

  undo(){ return undo(this.view.state, this.view.dispatch); }
  redo(){ return redo(this.view.state, this.view.dispatch); }

  setEditable(editable){
    this.locked = !editable;
    this.view.setProps({editable:() => !this.locked});
    if(this.locked) this.clearSelectionCaret();
    else this.scheduleSelectionCaretSync();
  }

  setReferenceContext(references=[]){
    const next = mergeReferenceLists(references);
    const signature = list => JSON.stringify(list.map(ref => [
      ref.refId || '', referenceIdentity(ref), ref.url || '', ref.kind || '', ref.name || ''
    ]));
    if(signature(next) === signature(this.referenceContext)) return;
    this.referenceContext = next;
    this.syncReferenceTokens();
  }

  syncEmptyState(){
    this.host.classList.toggle('prompt-editor-empty', this.isEmpty());
  }

  ensureReference(raw){
    const identity = referenceIdentity(raw);
    const existing = this.references.find(ref => referenceIdentity(ref) === identity)
      || this.referenceContext.find(ref => referenceIdentity(ref) === identity);
    if(existing){
      const promptOwned = this.references.find(ref => String(ref.refId) === String(existing.refId));
      if(promptOwned) return promptOwned;
      const imported = normalizeReference({...existing, ...raw, refId:existing.refId}, new Set(this.references.map(ref => ref.refId)));
      this.references = mergeReferenceLists(this.references, [imported]);
      return imported;
    }
    const used = new Set(this.references.map(ref => ref.refId));
    const ref = normalizeReference(raw, used);
    this.references = mergeReferenceLists(this.references, [ref]);
    return this.references.find(item => referenceIdentity(item) === referenceIdentity(ref)) || ref;
  }

  insertReference(raw){
    const ref = this.ensureReference(raw);
    const state = this.view.state;
    let transaction = state.tr;
    if(state.selection.empty && state.selection.from > 0){
      const before = state.doc.textBetween(state.selection.from - 1, state.selection.from, '', '');
      if(before === '@') transaction = transaction.delete(state.selection.from - 1, state.selection.from);
    }
    const insertion = transaction.selection;
    const insertionFrom = insertion.from;
    const addLeftSpace = inlineNeighborNeedsSpace(insertion.$from.nodeBefore, 'left');
    const addRightSpace = !insertion.$to.nodeAfter
      || inlineNeighborNeedsSpace(insertion.$to.nodeAfter, 'right');
    transaction = transaction.replaceSelectionWith(schema.nodes.media_reference.create({refId:ref.refId}), false);
    if(addRightSpace) transaction = transaction.insertText(' ');
    if(addLeftSpace) transaction = transaction.insertText(' ', insertionFrom);
    transaction = transaction.scrollIntoView();
    this.view.dispatch(transaction);
    this.view.focus();
    return ref;
  }

  focus(){ this.view.focus(); this.scheduleSelectionCaretSync(); }
  focusEnd(){
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.atEnd(this.view.state.doc)).scrollIntoView());
    this.view.focus();
    this.scheduleSelectionCaretSync();
  }

  textBeforeCaret(){
    const selection = this.view.state.selection;
    if(!selection.empty) return '';
    const parent = selection.$from.parent;
    return parent.textBetween(0, selection.$from.parentOffset, '', () => '\uFFFC');
  }

  caretRect(){
    try {
      const coords = this.view.coordsAtPos(this.view.state.selection.from);
      return {left:coords.left, right:coords.right, top:coords.top, bottom:coords.bottom, width:Math.max(0, coords.right - coords.left), height:Math.max(0, coords.bottom - coords.top)};
    } catch(_) { return null; }
  }

  beginPointerReferenceDrag(dom, getPos, event){
    const from = typeof getPos === 'function' ? getPos() : -1;
    if(!Number.isFinite(from) || from < 0) return;
    this.view.focus();
    const origin = {x:event.clientX, y:event.clientY};
    const initialSelection = this.view.state.selection;
    let preview = null;
    let moved = false;
    const onMove = moveEvent => {
      if(!moved && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 4) return;
      moved = true;
      if(!preview){
        this.referenceDragActive = true;
        this.clearSelectionCaret({keepNativeHidden:true});
        dom.classList.add('dragging');
        preview = dom.cloneNode(true);
        preview.classList.add('prompt-reference-drag-preview');
        document.body.appendChild(preview);
      }
      const previewRect = preview.getBoundingClientRect();
      const gap = 12;
      const left = Math.max(8, Math.min(window.innerWidth - previewRect.width - 8, moveEvent.clientX - previewRect.width / 2));
      const preferredTop = moveEvent.clientY - previewRect.height - gap;
      const top = preferredTop >= 8 ? preferredTop : moveEvent.clientY + gap;
      preview.style.left = `${left}px`;
      preview.style.top = `${top}px`;
      this.showReferenceDragCursor(moveEvent.clientX, moveEvent.clientY);
    };
    const finish = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', cancel, true);
      dom.classList.remove('dragging');
      preview?.remove();
      const targetPos = this.dragTargetPos;
      this.clearReferenceDragCursor();
      this.referenceDragActive = false;
      if(!initialSelection.eq(this.view.state.selection)){
        this.view.dispatch(this.view.state.tr.setSelection(initialSelection));
      }
      if(moved){
        if(Number.isFinite(targetPos)) this.moveReferenceToPosition(from, targetPos);
        else this.scheduleSelectionCaretSync();
      } else this.scheduleSelectionCaretSync();
    };
    const cancel = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', cancel, true);
      dom.classList.remove('dragging');
      preview?.remove();
      this.clearReferenceDragCursor();
      this.referenceDragActive = false;
      if(!initialSelection.eq(this.view.state.selection)){
        this.view.dispatch(this.view.state.tr.setSelection(initialSelection));
      }
      this.scheduleSelectionCaretSync();
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', cancel, true);
  }

  renderedPromptLines(){
    const rects = [];
    const addRect = rect => {
      if(!rect || rect.width <= .5 || rect.height <= .5) return;
      rects.push({left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom});
    };
    this.view.dom.querySelectorAll('p').forEach(paragraph => {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      Array.from(range.getClientRects()).forEach(addRect);
    });
    this.view.dom.querySelectorAll('.prompt-reference-token').forEach(token => addRect(token.getBoundingClientRect()));
    const lines = [];
    rects.sort((a, b) => a.top - b.top || a.left - b.left).forEach(rect => {
      const center = (rect.top + rect.bottom) / 2;
      const height = rect.bottom - rect.top;
      let line = lines.find(candidate => {
        const candidateCenter = (candidate.top + candidate.bottom) / 2;
        const candidateHeight = candidate.bottom - candidate.top;
        return Math.abs(center - candidateCenter) <= Math.max(3, Math.min(height, candidateHeight) * .55);
      });
      if(!line){
        line = {...rect};
        lines.push(line);
        return;
      }
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
    });
    return lines.sort((a, b) => a.top - b.top);
  }

  renderedPromptLineAtPoint(clientX, clientY){
    const hostRect = this.host.getBoundingClientRect();
    const scaleX = this.host.offsetWidth ? hostRect.width / this.host.offsetWidth : 1;
    const scaleY = this.host.offsetHeight ? hostRect.height / this.host.offsetHeight : scaleX;
    const verticalPadding = Math.max(2, 2 * Math.max(.1, scaleY));
    const leadingPadding = Math.max(6, 6 * Math.max(.1, scaleX));
    const candidates = this.renderedPromptLines().filter(line => (
      clientY >= line.top - verticalPadding && clientY <= line.bottom + verticalPadding
      && clientX >= line.left - leadingPadding
      && clientX <= line.right + Math.max(18, (line.bottom - line.top) * .8)
    ));
    if(!candidates.length) return null;
    return candidates.sort((a, b) => {
      const aDistance = Math.abs(clientY - (a.top + a.bottom) / 2);
      const bDistance = Math.abs(clientY - (b.top + b.bottom) / 2);
      return aDistance - bDistance;
    })[0];
  }

  referenceDragTargetAtCoords(clientX, clientY){
    const line = this.renderedPromptLineAtPoint(clientX, clientY);
    if(!line) return null;
    // Once a real rendered line is hit, resolve the position through that
    // line's center. Near a line's upper/lower edge ProseMirror may otherwise
    // resolve the same X coordinate to the paragraph boundary.
    const lineCenterY = (line.top + line.bottom) / 2;
    const coords = this.view.posAtCoords({left:clientX, top:lineCenterY});
    if(!coords) return null;
    const rawPosition = Math.max(0, Math.min(
      coords.pos,
      this.view.state.doc.content.size
    ));
    const position = this.inlineInsertionPosition(this.view.state.doc, rawPosition);
    if(!Number.isFinite(position)) return null;
    // A document position at a wrap or paragraph boundary has two visual
    // sides. Pick the side nearest the pointer so an end position is drawn at
    // the line end instead of the next/paragraph line start.
    const geometry = this.caretOverlayGeometry(position, line, clientX);
    if(!geometry) return null;
    const pointedElement = document.elementFromPoint(clientX, clientY);
    const pointedToken = pointedElement?.closest?.('.prompt-reference-token');
    const overPromptToken = Boolean(pointedToken && this.view.dom.contains(pointedToken));
    // A text hit should resolve within roughly half a glyph of the pointer.
    // Keep token hits exempt because an atom can legitimately resolve to
    // either outer edge while the pointer is near its center.
    const inTrailingZone = clientX >= line.right;
    const horizontalTolerance = inTrailingZone
      ? Math.max(18, (line.bottom - line.top) * .8)
      : Math.max(10, 9 * Math.max(.1, geometry.scaleX));
    const verticalTolerance = Math.max(4, 5 * Math.max(.1, geometry.scaleY));
    if(!overPromptToken && Math.abs(clientX - geometry.viewportLeft) > horizontalTolerance) return null;
    if(clientY < geometry.hitTop - verticalTolerance || clientY > geometry.hitBottom + verticalTolerance) return null;
    return {position, geometry};
  }

  showReferenceDragCursor(clientX, clientY){
    const target = this.referenceDragTargetAtCoords(clientX, clientY);
    if(!target){
      this.clearReferenceDragCursor();
      return false;
    }
    this.dragTargetPos = target.position;
    const {geometry} = target;
    if(!this.dragCaretElement){
      this.dragCaretElement = document.createElement('span');
      this.dragCaretElement.className = 'prompt-reference-drop-caret prompt-caret-overlay';
      this.dragCaretElement.setAttribute('aria-hidden', 'true');
      this.host.appendChild(this.dragCaretElement);
    }
    Object.assign(this.dragCaretElement.style, {
      left:`${geometry.left}px`,
      top:`${geometry.top}px`,
      height:`${geometry.height}px`,
      backgroundColor:geometry.color
    });
    return true;
  }

  clearReferenceDragCursor(){
    this.dragTargetPos = null;
    this.dragCaretElement?.remove();
    this.dragCaretElement = null;
  }

  inlineInsertionPosition(doc, position){
    const clamped = Math.max(0, Math.min(position, doc.content.size));
    const $position = doc.resolve(clamped);
    if($position.parent.inlineContent) return clamped;
    for(const bias of [1, -1]){
      try {
        const selection = TextSelection.near($position, bias);
        if(selection.$from.parent.inlineContent) return selection.from;
      } catch(_) {}
    }
    return null;
  }

  moveReferenceToPosition(from, targetPos){
    const view = this.view;
    const node = view.state.doc.nodeAt(from);
    if(!node || node.type !== schema.nodes.media_reference) return false;
    let to = this.inlineInsertionPosition(view.state.doc, targetPos);
    if(!Number.isFinite(to)) return false;
    if(to === from || to === from + node.nodeSize) return false;
    const transaction = view.state.tr.delete(from, from + node.nodeSize);
    if(to > from) to -= node.nodeSize;
    to = this.inlineInsertionPosition(transaction.doc, to);
    if(!Number.isFinite(to)) return false;
    try {
      transaction.insert(to, node);
      const cursorPos = Math.max(0, Math.min(to + node.nodeSize, transaction.doc.content.size));
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(cursorPos), 1)).scrollIntoView();
    } catch(_) {
      return false;
    }
    view.dispatch(transaction);
    view.focus();
    return true;
  }

  renderReferenceToken(dom, refId){
    const displayReferences = this.displayReferences();
    const ref = displayReferences.find(item => String(item.refId || '') === String(refId))
      || this.references.find(item => String(item.refId || '') === String(refId));
    const label = ref ? referenceLabel(ref, displayReferences) : '引用缺失';
    dom.dataset.refId = refId;
    dom.dataset.url = ref?.url || '';
    dom.dataset.kind = ref?.kind || 'image';
    dom.dataset.name = ref?.name || '图片';
    dom.dataset.nodeId = ref?.nodeId || '';
    dom.dataset.imageIndex = String(ref?.imageIndex ?? '');
    dom.dataset.assetUris = JSON.stringify(ref?.asset_uris || {});
    dom.dataset.refLabel = label;
    dom.classList.toggle('prompt-reference-missing', !ref);
    const renderSignature = JSON.stringify([ref?.kind || 'image', ref?.url || '', label, Boolean(ref)]);
    if(dom.dataset.renderSignature === renderSignature) return;
    dom.dataset.renderSignature = renderSignature;
    dom.innerHTML = '';
    if(ref?.kind === 'audio'){
      const icon = document.createElement('span');
      icon.className = 'mention-audio-thumb';
      icon.textContent = '♪';
      dom.appendChild(icon);
    } else if(ref?.kind === 'video'){
      const video = document.createElement('video');
      video.src = ref.url || '';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.draggable = false;
      dom.appendChild(video);
    } else {
      const image = document.createElement('img');
      image.src = ref?.url || '';
      image.alt = '';
      image.draggable = false;
      dom.appendChild(image);
    }
    const labelElement = document.createElement('span');
    labelElement.className = 'mention-token-label';
    labelElement.textContent = label;
    dom.appendChild(labelElement);
    dom.setAttribute('aria-label', label);
  }

  syncReferenceTokens(){
    this.host.querySelectorAll('.prompt-reference-token[data-ref-id]').forEach(dom => this.renderReferenceToken(dom, dom.dataset.refId || ''));
  }

  sliceExchangeText(slice){
    const refs = new Map(this.references.map(ref => [String(ref.refId || ''), ref]));
    const ordered = this.displayReferences();
    const blocks = [];
    let current = '';
    slice.content.forEach(node => {
      if(node.isTextblock){
        let text = '';
        node.forEach(child => {
          if(child.isText) text += child.text || '';
          else if(child.type.name === 'hard_break') text += '\n';
          else if(child.type.name === 'media_reference'){
            const ref = refs.get(String(child.attrs.refId || ''));
            text += ref ? referencePlaceholder(ref, ordered) : '{{Missing Reference}}';
          }
        });
        blocks.push(text);
      } else if(node.isText) current += node.text || '';
      else if(node.type.name === 'media_reference'){
        const ref = refs.get(String(node.attrs.refId || ''));
        current += ref ? referencePlaceholder(ref, ordered) : '{{Missing Reference}}';
      }
    });
    if(current) blocks.push(current);
    return blocks.join('\n');
  }

  handleCopyCut(view, event, cut){
    if(!event.clipboardData || view.state.selection.empty) return false;
    const slice = view.state.selection.content();
    const ids = sliceReferenceIds(slice);
    const references = this.references.filter(ref => ids.has(String(ref.refId || '')));
    const text = this.sliceExchangeText(slice);
    event.clipboardData.setData(PROMPT_CLIPBOARD_MIME, JSON.stringify({version:1, slice:slice.toJSON(), references}));
    event.clipboardData.setData('text/plain', text);
    event.clipboardData.setData('text/html', `<meta charset="utf-8"><span>${escapeHtml(text).replace(/\n/g, '<br>')}</span>`);
    event.preventDefault();
    if(cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
    return true;
  }

  importReferenceBundle(references=[]){
    const mapping = {};
    const usedIds = new Set(this.references.map(ref => ref.refId));
    references.forEach(raw => {
      const identity = referenceIdentity(raw);
      const existing = this.references.find(ref => referenceIdentity(ref) === identity)
        || this.referenceContext.find(ref => referenceIdentity(ref) === identity);
      if(existing){
        let imported = this.references.find(ref => referenceIdentity(ref) === identity);
        if(!imported){
          imported = normalizeReference(existing, usedIds);
          usedIds.add(imported.refId);
          this.references.push(imported);
        }
        mapping[raw.refId] = imported.refId;
        return;
      }
      const requestedId = String(raw.refId || '');
      const collides = requestedId && this.references.some(ref => String(ref.refId) === requestedId && referenceIdentity(ref) !== identity);
      const ref = normalizeReference({...raw, refId:collides ? createReferenceId({...raw, refId:''}, usedIds) : requestedId}, usedIds);
      usedIds.add(ref.refId);
      this.references.push(ref);
      mapping[requestedId] = ref.refId;
    });
    this.references = mergeReferenceLists(this.references);
    return mapping;
  }

  handlePaste(view, event){
    const clipboard = event.clipboardData;
    if(!clipboard) return false;
    const files = [...(clipboard.files || [])].filter(file => /^(image|video|audio)\//.test(String(file.type || '')));
    if(files.length){
      event.preventDefault();
      this.host.dispatchEvent(new CustomEvent('smart-prompt-files-paste', {bubbles:true, detail:{files}}));
      return true;
    }
    const structured = clipboard.getData(PROMPT_CLIPBOARD_MIME);
    if(structured){
      try {
        const payload = JSON.parse(structured);
        const mapping = this.importReferenceBundle(payload.references || []);
        const importedSlice = Slice.fromJSON(schema, remapSliceJson(payload.slice, mapping));
        // Prompt documents use paragraphs only as line containers. Always paste
        // their contents as an open slice so a copied whole paragraph cannot be
        // fitted as a new block and introduce a leading/duplicate newline.
        const slice = Slice.maxOpen(importedSlice.content);
        event.preventDefault();
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      } catch(_) {}
    }
    const text = clipboard.getData('text/plain');
    if(text !== ''){
      const ordered = this.displayReferences();
      const parsed = textToPromptDocument(text, ordered);
      const usedIds = new Set();
      const walk = node => {
        if(node?.type === 'media_reference' && node.attrs?.refId) usedIds.add(String(node.attrs.refId));
        (node?.content || []).forEach(walk);
      };
      walk(parsed);
      ordered.filter(ref => usedIds.has(String(ref.refId || ''))).forEach(ref => this.ensureReference(ref));
      const doc = schema.nodeFromJSON(parsed);
      const slice = Slice.maxOpen(doc.content);
      event.preventDefault();
      view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
      return true;
    }
    return false;
  }

  destroy(){
    this.destroyed = true;
    this.caretResizeObserver?.disconnect();
    this.caretResizeObserver = null;
    this.clearReferenceDragCursor();
    this.clearSelectionCaret();
    this.view.destroy();
  }

  static emptyDocument(){ return emptyPromptDocument(); }
  static textDocument(text, references=[]){ return textToPromptDocument(text, references); }
  static partsFromJSON(docJson, references=[]){ return promptDocumentParts(docJson || emptyPromptDocument(), references); }
  static exchangeText(docJson, references=[], orderedReferences=references){ return promptDocumentExchangeText(docJson || emptyPromptDocument(), references, orderedReferences); }
}

window.SmartPromptEditor = SmartPromptEditor;
