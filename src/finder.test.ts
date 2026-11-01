import { describe, expect, it } from 'vitest';
import { finderName } from './finder';

describe('Show in Finder', () => {
  it('names the file after the item, with its type’s extension', () => {
    expect(finderName({ name: 'Chroma_Countdown_4K', mime: 'video/mp4' })).toBe('Chroma_Countdown_4K.mp4');
    expect(finderName({ name: 'Walk In.wav', mime: 'audio/wav' })).toBe('Walk In.wav');
    expect(finderName({ name: 'Logo', mime: 'image/png' })).toBe('Logo.png');
    expect(finderName({ name: 'a/b: c', mime: 'application/x-unknown' })).toBe('a-b- c');
  });
});
