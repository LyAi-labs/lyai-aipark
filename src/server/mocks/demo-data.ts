/**
 * Server-Side Demo & Mock Data Catalog
 * Explicitly tagged as DEMO_ONLY to prevent accidental confusion with production data.
 */

export const DEMO_ONLY_YOUTUBE_CHANNEL = Object.freeze({
  isDemoMode: true,
  connected: true,
  channelId: 'UC-KTN-KIDSTOON-STUDIO-DEMO',
  channelTitle: 'KidsToon Studio Oficial (Sandbox)',
  channelCustomUrl: '@KidsToonStudioOfficial',
  subscriberCount: '142,500',
  videoCount: 48,
  viewCount: '18,430,920',
  avatarUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=160&auto=format&fit=crop&q=80',
  statusMessage: 'Canal Sandbox conectado en modo Demostración. Publicaciones reales requieren OAuth de YouTube habilitado.'
});

export const DEMO_ONLY_ANALYTICS = Object.freeze({
  isDemoMode: true,
  views28Days: '18.4M',
  watchTimeHours: '412.8K h',
  avgViewDuration: '03:42',
  retentionPercent: '76.4%',
  ctrPercent: '11.8%',
  growthVsLastMonth: '+14.2%'
});

export const DEMO_ONLY_FALLBACK_STORY = Object.freeze({
  isDemo: true,
  title: 'Milo y la Caja de las Sorpresas',
  logline: 'Un pequeño zorro llamado Milo descubre que la verdadera magia de sus juguetes aparece cuando los comparte con sus amigos del bosque.',
  target_age: '4-6',
  educational_objective: 'Compartir y empatía grupal',
  characters: [
    {
      name: 'Milo',
      species: 'Zorro',
      personality: 'Curioso, entusiasta pero un poco posesivo con sus inventos',
      age: '5 años',
      visualFeatures: 'Pelaje naranja brillante, hocico crema suave, grandes ojos avellana expresivos',
      clothing: 'Mochila verde oliva con broches amarillos y pequeña bufanda tejida',
      colorPalette: ['#EA580C', '#FEF3C7', '#65A30D'],
      voiceProfile: 'Voz infantil cálida, tono travieso y alegre (pitch: 1.05, speed: 0.95)',
      visualConsistencyPrompt: 'Cute original 3D cartoon fox, orange fur, cream muzzle, large expressive hazel eyes, green backpack, rounded proportions, friendly facial expression, studio lighting, Pixar aesthetic.',
      masterPrompt: 'Protagonist Milo: Stylized 3D fox character, clean geometry, ultra-soft fur shaders, vibrant cartoon palette, consistent silhouette.'
    },
    {
      name: 'Tula',
      species: 'Liebre',
      personality: 'Ágil, bondadosa y apasionada por los juegos al aire libre',
      age: '5 años',
      visualFeatures: 'Pelaje gris perla, orejas largas con puntas blancas, sonrisa tímida',
      clothing: 'Chaleco azul cielo con estrellas bordadas',
      colorPalette: ['#94A3B8', '#BAE6FD', '#F8FAFC'],
      voiceProfile: 'Voz suave, dulce y rápida (pitch: 1.15, speed: 1.0)',
      visualConsistencyPrompt: 'Cute 3D cartoon hare, soft silver fur, sky blue vest, friendly large ears, Pixar animated film quality, consistent design.',
      masterPrompt: 'Tula the hare: delicate animated character, expressive eyes, sky-blue vest, smooth shading.'
    }
  ],
  scenes: [
    {
      scene_id: 'SCENE_01',
      location: 'El Claro del Roble Dorado',
      time: 'Mañana soleada',
      characters: ['Milo'],
      action: 'Milo salta emocionado abriendo una brillante caja de madera llena de peonzas de cristal.',
      camera: 'Plano general medio con suave paneo horizontal siguiendo a Milo',
      dialogue: '¡Mirad esto! ¡Son mis peonzas mágicas y brillan como luciérnagas!',
      narration: 'En el corazón del bosque, el sol de la mañana iluminaba el mayor tesoro de Milo.',
      sound_effects: 'Trino de pájaros, crujido de hojas secas, tintineo mágico de cristal',
      music: 'Melodía alegre de xilófono y pizzicato de cuerdas',
      duration: 16,
      visual_prompt: 'High quality 3D cartoon scene, Milo the orange fox sitting near a massive golden oak tree opening a polished wooden chest filled with luminous spinning tops, warm morning sunbeams, cinematic cartoon rendering.'
    },
    {
      scene_id: 'SCENE_02',
      location: 'El Sendero de los Tréboles',
      time: 'Mediodía',
      characters: ['Milo', 'Tula'],
      action: 'Tula se acerca con curiosidad estirando la patita para ver una peonza, pero Milo la abraza contra su pecho.',
      camera: 'Primer plano de las expresiones: asombro en Tula y duda protectora en Milo',
      dialogue: 'Tula: "¿Puedo hacer girar una? ¡Parecen estrellas!" — Milo: "Oh... son muy delicadas, Tula."',
      narration: 'Milo quería proteger su tesoro, pero notó una pequeña sombra de tristeza en los ojos de su amiga.',
      sound_effects: 'Brisa suave, pisadas ligeras sobre hierba',
      music: 'Cuerdas más lentas y reflexivas en tono menor suave',
      duration: 18,
      visual_prompt: '3D cartoon frame of Milo holding his wooden chest defensively while Tula the silver hare gazes with gentle longing, emerald forest backdrop, emotionally expressive 3D character animation render.'
    },
    {
      scene_id: 'SCENE_03',
      location: 'La Colina del Viento Dulce',
      time: 'Tarde dorada',
      characters: ['Milo', 'Tula'],
      action: 'Milo suspira, sonríe y le entrega la peonza azul más hermosa a Tula. Ambos las hacen bailar juntas en una roca plana.',
      camera: 'Travelling circular mostrando las dos peonzas girando y la sincronía de risas de los personajes',
      dialogue: '¡Giran el doble de rápido si las lanzamos juntos! ¡Mira la luz que hacen!',
      narration: 'Fue en ese instante cuando Milo comprendió que un juguete solo es divertido si hay alguien con quien reír.',
      sound_effects: 'Zumbido armonioso de peonzas girando, carcajadas infantiles',
      music: 'Crescendo optimista con flauta traversa y campanillas',
      duration: 20,
      visual_prompt: 'Cinematic 3D animation scene, Milo and Tula cheering joyfully as two glowing spinning tops dance on a flat river stone, glowing swirl trails, warm sunset colors, beautiful Disney-Pixar render style.'
    },
    {
      scene_id: 'SCENE_04',
      location: 'El Hogar del Roble al Atardecer',
      time: 'Puesta de sol',
      characters: ['Milo', 'Tula'],
      action: 'Milo y Tula guardan los juguetes juntos en la caja, despidiéndose con un choque de patitas.',
      camera: 'Plano general alejándose lentamente hacia el cielo estrellado que empieza a nacer',
      dialogue: '¡Mañana inventaremos un circuito nuevo para todos los amigos!',
      narration: 'Y aquella tarde, la caja de Milo ya no guardaba solo peonzas: guardaba una amistad que brillaba para siempre.',
      sound_effects: 'Cierre suave de la caja de madera, grillos del atardecer',
      music: 'Tema principal en piano suave y cuerdas cálidas concluyendo con nota dulce',
      duration: 16,
      visual_prompt: 'Peaceful 3D cartoon sunset scene, Milo the fox and Tula the hare waving goodbye by a cozy hollow tree house, fireflies emerging, purple and orange twilight sky, end of episode frame.'
    }
  ],
  ending: 'Milo descubre que compartir sus juguetes multiplica la diversión y crea recuerdos felices.',
  moral: 'La alegría compartida se vuelve el doble de brillante.',
  quality_notes: 'Cumple al 100% con los estándares pedagógicos para 4-6 años: sin elementos agresivos, vocabulario constructivo y resolución empática.'
});

export function createFakeYouTubePublication(projectId: string, title: string, privacyStatus: string, scheduledAt: string | null) {
  return {
    isDemo: true,
    publishId: 'pub_mock_' + Date.now().toString(36),
    projectId,
    title,
    privacyStatus: privacyStatus || 'private',
    scheduledAt: scheduledAt || null,
    madeForKids: true,
    publishedAt: scheduledAt ? null : new Date().toISOString(),
    youtubeVideoId: 'yt_mock_' + Math.random().toString(36).substring(2, 9),
    youtubeUrl: `https://youtube.com/watch?v=mock_${Math.random().toString(36).substring(2, 7)}`,
    status: scheduledAt ? 'scheduled' : 'published',
  };
}
