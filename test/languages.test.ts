import { describe, expect, it } from 'vitest';

import {
  INTRON_STT_LANGUAGES,
  INTRON_STT_SUPPORTED_LANGUAGES_URL,
  INTRON_TTS_LANGUAGES,
  INTRON_TTS_SUPPORTED_LANGUAGES_URL,
  isKnownIntronSttLanguageCode,
  isKnownIntronTtsLanguageCode,
  type IntronTtsVoiceConfiguration,
} from '../src/index.js';

describe('language and voice catalogs', () => {
  it('exports documented STT language entries and source URL', () => {
    expect(INTRON_STT_SUPPORTED_LANGUAGES_URL).toBe(
      'https://docs.voice.intron.io/docs/stt/supported-languages',
    );
    expect(INTRON_STT_LANGUAGES).toContainEqual({
      name: 'Yoruba-English',
      code: 'yo',
      codeSwitched: true,
    });
    expect(INTRON_STT_LANGUAGES).toContainEqual({
      name: 'English',
      code: 'en',
      codeSwitched: false,
    });
    expect(isKnownIntronSttLanguageCode('yo')).toBe(true);
    expect(isKnownIntronSttLanguageCode('new-service-code')).toBe(false);
  });

  it('exports documented TTS language entries and source URL', () => {
    expect(INTRON_TTS_SUPPORTED_LANGUAGES_URL).toBe(
      'https://docs.voice.intron.io/docs/tts/supported-languages-and-accents',
    );
    expect(INTRON_TTS_LANGUAGES).toContainEqual({
      name: 'Swahili',
      code: 'sw',
    });
    expect(INTRON_TTS_LANGUAGES).toContainEqual({
      name: 'English',
      code: 'en',
    });
    expect(isKnownIntronTtsLanguageCode('sw')).toBe(true);
    expect(isKnownIntronTtsLanguageCode('new-service-code')).toBe(false);
  });

  it('allows raw documented accent values in voice configuration', () => {
    const voice: IntronTtsVoiceConfiguration = {
      voiceLanguage: 'en',
      voiceAccent: 'hausa',
      voiceGender: 'female',
      outputAudioFormat: 'wav',
    };

    expect(voice.voiceAccent).toBe('hausa');
  });
});
