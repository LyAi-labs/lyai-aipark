/**
 * Cartoon Studio — Voice Catalog & Character Presets
 * Phase 06: Real Voice & Audio Pipeline
 *
 * Defines canonical voice definitions and archetype presets tailored for
 * children's cartoon characters and animated storytelling.
 */

export interface VoicePreset {
  id: string;
  name: string;
  providerVoiceId: string;
  provider: 'google-cloud-tts' | 'synthetic';
  language: string;
  gender: 'FEMALE' | 'MALE' | 'NEUTRAL';
  targetAgeGroup: 'child' | 'teen' | 'adult';
  recommendedPitch: number;
  recommendedSpeed: number;
  timbre: string;
  description: string;
}

export const VOICE_CATALOG: readonly VoicePreset[] = Object.freeze([
  {
    id: 'milo-preschool',
    name: 'Milo (Zorro Aventurero)',
    providerVoiceId: 'es-ES-Neural2-A',
    provider: 'google-cloud-tts',
    language: 'es-ES',
    gender: 'FEMALE',
    targetAgeGroup: 'child',
    recommendedPitch: 1.15,
    recommendedSpeed: 0.95,
    timbre: 'bright-curious',
    description: 'Voz infantil, enérgica y curiosa. Ideal para protagonistas preescolares exploradores.',
  },
  {
    id: 'tula-hare',
    name: 'Tula (Liebre Sabia)',
    providerVoiceId: 'es-ES-Neural2-C',
    provider: 'google-cloud-tts',
    language: 'es-ES',
    gender: 'FEMALE',
    targetAgeGroup: 'child',
    recommendedPitch: 1.25,
    recommendedSpeed: 1.05,
    timbre: 'gentle-quick',
    description: 'Voz vivaz, reflexiva y amistosa. Perfecta para co-protagonistas perspicaces.',
  },
  {
    id: 'narrator-storybook',
    name: 'Narrador Cuentacuentos',
    providerVoiceId: 'es-ES-Neural2-B',
    provider: 'google-cloud-tts',
    language: 'es-ES',
    gender: 'MALE',
    targetAgeGroup: 'adult',
    recommendedPitch: 0.92,
    recommendedSpeed: 0.92,
    timbre: 'warm-paternal',
    description: 'Tono cálido, pausado y envolvente. Diseñado para narración en off e introducciones.',
  },
  {
    id: 'bubu-bear',
    name: 'Bubu (Oso Bonachón)',
    providerVoiceId: 'es-ES-Neural2-F',
    provider: 'google-cloud-tts',
    language: 'es-ES',
    gender: 'MALE',
    targetAgeGroup: 'adult',
    recommendedPitch: 0.78,
    recommendedSpeed: 0.88,
    timbre: 'deep-cozy',
    description: 'Voz grave, apacible y tranquilizadora. Para personajes protectores y cósmicos.',
  },
  {
    id: 'chico-latam',
    name: 'Mateo (Latinoamérica)',
    providerVoiceId: 'es-US-Neural2-B',
    provider: 'google-cloud-tts',
    language: 'es-US',
    gender: 'MALE',
    targetAgeGroup: 'child',
    recommendedPitch: 1.10,
    recommendedSpeed: 0.98,
    timbre: 'friendly-latam',
    description: 'Acento neutro hispanoamericano para audiencias globales infantiles.',
  },
  {
    id: 'piper-english',
    name: 'Oliver (English Global)',
    providerVoiceId: 'en-US-Neural2-A',
    provider: 'google-cloud-tts',
    language: 'en-US',
    gender: 'MALE',
    targetAgeGroup: 'child',
    recommendedPitch: 1.12,
    recommendedSpeed: 0.96,
    timbre: 'expressive-english',
    description: 'Preschool English localization protagonist voice.',
  },
]);

export function findVoicePresetById(voiceId: string): VoicePreset | undefined {
  return VOICE_CATALOG.find((v) => v.id === voiceId || v.providerVoiceId === voiceId);
}

export function getVoicesForLanguage(language = 'es-ES'): VoicePreset[] {
  const normalized = language.toLowerCase();
  return VOICE_CATALOG.filter((v) => v.language.toLowerCase().startsWith(normalized.slice(0, 2)));
}
