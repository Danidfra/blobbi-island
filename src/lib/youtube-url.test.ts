import { describe, it, expect } from 'vitest';
import { isValidYouTubeVideoId, parseYouTubeInput } from './youtube-url';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeInput', () => {
  describe('accepts', () => {
    it.each([
      ['a bare id', ID],
      ['a watch URL', `https://www.youtube.com/watch?v=${ID}`],
      ['a watch URL without www', `https://youtube.com/watch?v=${ID}`],
      ['a mobile watch URL', `https://m.youtube.com/watch?v=${ID}`],
      ['a YouTube Music URL', `https://music.youtube.com/watch?v=${ID}`],
      ['a short link', `https://youtu.be/${ID}`],
      ['an embed URL', `https://www.youtube.com/embed/${ID}`],
      ['a nocookie embed URL', `https://www.youtube-nocookie.com/embed/${ID}`],
      ['a shorts URL', `https://www.youtube.com/shorts/${ID}`],
      ['a live URL', `https://www.youtube.com/live/${ID}`],
      ['a scheme-less link', `youtu.be/${ID}`],
      ['a link with surrounding whitespace', `  https://youtu.be/${ID}  `],
      ['a watch URL with extra params', `https://www.youtube.com/watch?app=desktop&v=${ID}&list=PL123`],
      ['an http link', `http://youtube.com/watch?v=${ID}`],
    ])('%s', (_label, input) => {
      expect(parseYouTubeInput(input)).toMatchObject({ ok: true, videoId: ID });
    });
  });

  describe('extracts a start offset', () => {
    it.each([
      [`https://youtu.be/${ID}?t=90`, 90],
      [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, 90],
      [`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`, 3723],
      [`https://www.youtube.com/watch?v=${ID}&start=42`, 42],
      [`https://www.youtube.com/watch?v=${ID}#t=15`, 15],
    ])('%s → %ss', (input, seconds) => {
      expect(parseYouTubeInput(input)).toEqual({ ok: true, videoId: ID, startSeconds: seconds });
    });

    it('omits the offset when there is none', () => {
      expect(parseYouTubeInput(`https://youtu.be/${ID}`)).toEqual({ ok: true, videoId: ID });
    });
  });

  describe('rejects', () => {
    it.each([
      ['an empty string', '', 'empty'],
      ['whitespace only', '   ', 'empty'],
      ['a non-YouTube link', 'https://vimeo.com/12345', 'not-a-youtube-link'],
      ['a lookalike host', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'not-a-youtube-link'],
      ['a YouTube page with no video', 'https://www.youtube.com/results?search_query=blobbi', 'no-video-id'],
      ['a channel URL', 'https://www.youtube.com/@someone', 'no-video-id'],
      ['a too-short id', 'abc123', 'invalid-video-id'],
      ['a too-long id', 'dQw4w9WgXcQextra', 'invalid-video-id'],
      ['an id with illegal characters', 'dQw4w9WgX!Q', 'invalid-video-id'],
      ['a watch URL with a malformed id', 'https://www.youtube.com/watch?v=short', 'invalid-video-id'],
    ])('%s', (_label, input, reason) => {
      expect(parseYouTubeInput(input)).toEqual({ ok: false, reason });
    });
  });

  it('accepts ids containing - and _', () => {
    expect(parseYouTubeInput('a-b_c1234XY')).toEqual({ ok: true, videoId: 'a-b_c1234XY' });
  });
});

describe('isValidYouTubeVideoId', () => {
  it.each([
    [ID, true],
    ['a-b_c1234XY', true],
    ['short', false],
    ['', false],
    [null, false],
    [123, false],
  ])('%s → %s', (value, expected) => {
    expect(isValidYouTubeVideoId(value)).toBe(expected);
  });
});
