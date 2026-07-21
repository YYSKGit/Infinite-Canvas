import test from 'node:test';
import assert from 'node:assert/strict';

import {parsePromptTextSegments, textToPromptDocument} from './prompt-model.mjs';

const references = [
  {refId:'image-1', kind:'image', url:'/one.png'},
  {refId:'image-2', kind:'image', url:'/two.png'},
  {refId:'video-1', kind:'video', url:'/one.mp4'},
  {refId:'audio-1', kind:'audio', url:'/one.mp3'}
];

test('parses canonical and log-friendly media reference aliases', () => {
  const segments = parsePromptTextSegments(
    '{{Image 1}} @image2 @Video1 图1 图片 2 视频1 @audio1 音频 1',
    references
  );
  assert.deepEqual(
    segments.filter(item => item.type === 'reference').map(item => item.refId),
    ['image-1', 'image-2', 'video-1', 'image-1', 'image-2', 'video-1', 'audio-1', 'audio-1']
  );
});

test('keeps unresolved aliases as their original text', () => {
  assert.deepEqual(parsePromptTextSegments('use @image9 and 图9', references), [
    {type:'text', text:'use '},
    {type:'text', text:'@image9', unresolved:true},
    {type:'text', text:' and '},
    {type:'text', text:'图9', unresolved:true}
  ]);
});

test('does not parse @ aliases embedded inside email-like text', () => {
  assert.deepEqual(parsePromptTextSegments('test@image1', references), [
    {type:'text', text:'test@image1'}
  ]);
});

test('converts aliases into media nodes without changing surrounding text', () => {
  assert.deepEqual(textToPromptDocument('before 图1 after', references), {
    type:'doc',
    content:[{
      type:'paragraph',
      content:[
        {type:'text', text:'before '},
        {type:'media_reference', attrs:{refId:'image-1'}},
        {type:'text', text:' after'}
      ]
    }]
  });
});
