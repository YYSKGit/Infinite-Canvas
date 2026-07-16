export function plainCaretCoords(rect){
  if(!rect) return null;
  const left = Number(rect.left ?? rect.x);
  const top = Number(rect.top ?? rect.y);
  const right = Number(rect.right ?? (left + Number(rect.width || 0)));
  const bottom = Number(rect.bottom ?? (top + Number(rect.height || 0)));
  if(![left, top, right, bottom].every(Number.isFinite)) return null;
  return {left, top, right, bottom};
}
