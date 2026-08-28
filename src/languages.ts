/** Source documentation URL for STT supported languages. */
export const INTRON_STT_SUPPORTED_LANGUAGES_URL =
  'https://docs.voice.intron.io/docs/stt/supported-languages' as const;

/** Source documentation URL for TTS supported languages and accents. */
export const INTRON_TTS_SUPPORTED_LANGUAGES_URL =
  'https://docs.voice.intron.io/docs/tts/supported-languages-and-accents' as const;

/** Known STT language codes from the current public documentation. */
export type IntronKnownSttLanguageCode =
  | 'af'
  | 'ak'
  | 'am'
  | 'ar'
  | 'bem'
  | 'bg'
  | 'cs'
  | 'da'
  | 'de'
  | 'el'
  | 'en'
  | 'es'
  | 'et'
  | 'ff'
  | 'ffm'
  | 'fi'
  | 'fr'
  | 'fub'
  | 'fuc'
  | 'fue'
  | 'fuf'
  | 'fuq'
  | 'fuv'
  | 'gaa'
  | 'ha'
  | 'hr'
  | 'hu'
  | 'ig'
  | 'it'
  | 'ki'
  | 'kr'
  | 'lg'
  | 'lt'
  | 'luo'
  | 'lv'
  | 'mt'
  | 'nl'
  | 'nso'
  | 'nup'
  | 'nyn'
  | 'om'
  | 'pcm'
  | 'pl'
  | 'pt'
  | 'ro'
  | 'ru'
  | 'rw'
  | 'sk'
  | 'sl'
  | 'sn'
  | 'st'
  | 'sv'
  | 'sw'
  | 'ti'
  | 'tn'
  | 'tw'
  | 'uk'
  | 'wo'
  | 'xh'
  | 'yo'
  | 'zu';

/** STT language code accepted by the SDK, including newly documented values. */
export type IntronSttLanguageCode =
  IntronKnownSttLanguageCode | (string & Record<never, never>);

/** Known TTS language codes from the current public documentation. */
export type IntronKnownTtsLanguageCode =
  | 'af'
  | 'am'
  | 'en'
  | 'ha'
  | 'ig'
  | 'lg'
  | 'om'
  | 'pcm'
  | 'rw'
  | 'sn'
  | 'sw'
  | 'wo'
  | 'yo';

/** TTS language code accepted by the SDK, including newly documented values. */
export type IntronTtsLanguageCode =
  IntronKnownTtsLanguageCode | (string & Record<never, never>);

/** TTS accent value accepted by the SDK. */
export type IntronTtsVoiceAccent = string & Record<never, never>;

/** Current SDK model for a documented STT language entry. */
export interface IntronSttLanguage {
  /** Human-readable language name from the documentation. */
  readonly name: string;
  /** Language code sent as `use_language_asr_input`. */
  readonly code: IntronKnownSttLanguageCode;
  /** Whether the documentation marks this entry as code-switched. */
  readonly codeSwitched: boolean;
}

/** Current SDK model for a documented TTS language entry. */
export interface IntronTtsLanguage {
  /** Human-readable language name from the documentation. */
  readonly name: string;
  /** Language code sent as `voice_language`. */
  readonly code: IntronKnownTtsLanguageCode;
}

/** TTS voice configuration fields shared by REST and streaming synthesis. */
export interface IntronTtsVoiceConfiguration {
  /** Language code sent as `voice_language`. */
  readonly voiceLanguage: IntronTtsLanguageCode;
  /** Accent value sent as `voice_accent`. */
  readonly voiceAccent: IntronTtsVoiceAccent;
  /** Voice gender sent as `voice_gender`. */
  readonly voiceGender: 'male' | 'female';
  /** Output format sent as `output_audio_format`. */
  readonly outputAudioFormat?: 'wav' | 'opus';
}

/** Documented STT languages at the time this SDK version was authored. */
export const INTRON_STT_LANGUAGES = [
  { name: 'Afrikaans-English', code: 'af', codeSwitched: true },
  { name: 'Akan-English', code: 'ak', codeSwitched: true },
  { name: 'Amharic-English', code: 'am', codeSwitched: true },
  { name: 'Arabic', code: 'ar', codeSwitched: false },
  { name: 'Bemba', code: 'bem', codeSwitched: false },
  { name: 'Bulgarian', code: 'bg', codeSwitched: false },
  { name: 'Czech', code: 'cs', codeSwitched: false },
  { name: 'Danish', code: 'da', codeSwitched: false },
  { name: 'German', code: 'de', codeSwitched: false },
  { name: 'Greek', code: 'el', codeSwitched: false },
  { name: 'English', code: 'en', codeSwitched: false },
  { name: 'Spanish', code: 'es', codeSwitched: false },
  { name: 'Estonian', code: 'et', codeSwitched: false },
  { name: 'Finnish', code: 'fi', codeSwitched: false },
  { name: 'French', code: 'fr', codeSwitched: false },
  { name: 'Fulani', code: 'ff', codeSwitched: false },
  { name: 'Fulani (Pulaar)', code: 'fuc', codeSwitched: false },
  { name: 'Fulani (Pular)', code: 'fuf', codeSwitched: false },
  { name: 'Fulani (Adamawa Fulfulde)', code: 'fub', codeSwitched: false },
  { name: 'Fulani (Nigerian Fulfulde)', code: 'fuv', codeSwitched: false },
  {
    name: 'Fulani (Central-Eastern Niger Fulfulde)',
    code: 'fuq',
    codeSwitched: false,
  },
  { name: 'Fulani (Borgu Fulfulde)', code: 'fue', codeSwitched: false },
  { name: 'Fulani (Maasina Fulfulde)', code: 'ffm', codeSwitched: false },
  { name: 'Ga', code: 'gaa', codeSwitched: false },
  { name: 'Hausa-English', code: 'ha', codeSwitched: true },
  { name: 'Croatian', code: 'hr', codeSwitched: false },
  { name: 'Hungarian', code: 'hu', codeSwitched: false },
  { name: 'Igbo-English', code: 'ig', codeSwitched: true },
  { name: 'Italian', code: 'it', codeSwitched: false },
  { name: 'Kikuyu', code: 'ki', codeSwitched: false },
  { name: 'Kanuri', code: 'kr', codeSwitched: false },
  { name: 'Luganda-English', code: 'lg', codeSwitched: true },
  { name: 'Lithuanian', code: 'lt', codeSwitched: false },
  { name: 'Dholuo (Luo)', code: 'luo', codeSwitched: false },
  { name: 'Latvian', code: 'lv', codeSwitched: false },
  { name: 'Maltese', code: 'mt', codeSwitched: false },
  { name: 'Dutch', code: 'nl', codeSwitched: false },
  { name: 'Northern Sotho', code: 'nso', codeSwitched: false },
  { name: 'Nupe', code: 'nup', codeSwitched: false },
  { name: 'Nyankole', code: 'nyn', codeSwitched: false },
  { name: 'Oromo', code: 'om', codeSwitched: false },
  { name: 'Pidgin-English', code: 'pcm', codeSwitched: true },
  { name: 'Polish', code: 'pl', codeSwitched: false },
  { name: 'Portuguese', code: 'pt', codeSwitched: false },
  { name: 'Romanian', code: 'ro', codeSwitched: false },
  { name: 'Russian', code: 'ru', codeSwitched: false },
  { name: 'Kinyarwanda-English-French', code: 'rw', codeSwitched: true },
  { name: 'Slovak', code: 'sk', codeSwitched: false },
  { name: 'Slovenian', code: 'sl', codeSwitched: false },
  { name: 'Shona', code: 'sn', codeSwitched: false },
  { name: 'Sotho', code: 'st', codeSwitched: false },
  { name: 'Swedish', code: 'sv', codeSwitched: false },
  { name: 'Swahili-English', code: 'sw', codeSwitched: true },
  { name: 'Tigrinya', code: 'ti', codeSwitched: false },
  { name: 'Tswana', code: 'tn', codeSwitched: false },
  { name: 'Twi', code: 'tw', codeSwitched: false },
  { name: 'Ukrainian', code: 'uk', codeSwitched: false },
  { name: 'Wolof-English', code: 'wo', codeSwitched: true },
  { name: 'Xhosa', code: 'xh', codeSwitched: false },
  { name: 'Yoruba-English', code: 'yo', codeSwitched: true },
  { name: 'Zulu-English', code: 'zu', codeSwitched: true },
] as const satisfies readonly IntronSttLanguage[];

/** Documented TTS languages at the time this SDK version was authored. */
export const INTRON_TTS_LANGUAGES = [
  { name: 'Afrikaans', code: 'af' },
  { name: 'Amharic', code: 'am' },
  { name: 'English', code: 'en' },
  { name: 'Hausa', code: 'ha' },
  { name: 'Igbo', code: 'ig' },
  { name: 'Kinyarwanda', code: 'rw' },
  { name: 'Luganda', code: 'lg' },
  { name: 'Oromo', code: 'om' },
  { name: 'Pidgin', code: 'pcm' },
  { name: 'Shona', code: 'sn' },
  { name: 'Swahili', code: 'sw' },
  { name: 'Wolof', code: 'wo' },
  { name: 'Yoruba', code: 'yo' },
] as const satisfies readonly IntronTtsLanguage[];

/** Returns true when the code is in the current documented STT catalog. */
export function isKnownIntronSttLanguageCode(
  code: string,
): code is IntronKnownSttLanguageCode {
  return INTRON_STT_LANGUAGES.some((language) => language.code === code);
}

/** Returns true when the code is in the current documented TTS catalog. */
export function isKnownIntronTtsLanguageCode(
  code: string,
): code is IntronKnownTtsLanguageCode {
  return INTRON_TTS_LANGUAGES.some((language) => language.code === code);
}
