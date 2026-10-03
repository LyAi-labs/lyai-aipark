import { PrismaClient, EpisodeStatus, QCCategory, QCSeverity, QCCheckStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial Cartoon Studio data...');

  // 1. Create Default Studio User
  const defaultUser = await prisma.user.upsert({
    where: { email: 'studio@kidstoon.local' },
    update: {},
    create: {
      email: 'studio@kidstoon.local',
      name: 'KidsToon Studio Lead',
    },
  });

  // 2. Create Master Series (Milo's Little Adventures)
  const defaultSeries = await prisma.series.upsert({
    where: { id: 'a0000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'a0000000-0000-0000-0000-000000000001',
      userId: defaultUser.id,
      name: "Milo's Little Adventures",
      description: 'Aventuras en el bosque preescolar enfocadas en resolución pacífica de conflictos y compañerismo.',
      mainCharacterName: 'Milo',
      visualStyle: '3D Stylized Pixar Cartoon, soft textures, warm lighting',
      targetAge: '4-6 years',
      language: 'Spanish',
      episodeLengthDefault: '3-5 min',
      narrativeRules: [
        'Cero violencia o situaciones de peligro no supervisadas',
        'Cada episodio debe cerrar con un aprendizaje explícito de Milo',
        'La paleta de color principal se mantiene entre ámbar, esmeralda y cielo cálido',
      ],
    },
  });

  // 3. Create Master Characters
  const miloMaster = await prisma.characterDefinition.upsert({
    where: { id: 'c0000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'c0000000-0000-0000-0000-000000000001',
      seriesId: defaultSeries.id,
      name: 'Milo el Zorro',
      species: 'Zorro rojo',
      personality: 'Curioso, entusiasta, juguetón',
      age: '5',
      colorPalette: ['#EA580C', '#FEF3C7', '#65A30D', '#3B82F6'],
      clothing: 'Mochila de aventurero verde oliva con hebillas doradas',
      visualFeatures: 'Pelaje naranja aterciopelado, orejas puntiagudas, ojos avellana brillantes',
      visualConsistencyPrompt: 'Cute original 3D cartoon fox, orange fur, cream muzzle, large expressive eyes, green backpack, rounded proportions, friendly facial expression, 3D animated film render.',
      masterPrompt: 'Consistent character render: Milo the fox, full body 3/4 angle, soft studio rim lighting, vivid stylized textures, 8k resolution cartoon character asset.',
      tagline: 'El pequeño explorador de grandes ideas',
      voiceProfiles: {
        create: [
          {
            provider: 'google-cloud-tts',
            voiceId: 'es-ES-Neural2-F',
            pitch: 1.05,
            speed: 0.95,
            timbre: 'Cálido, infantil y alegre',
            language: 'es-ES',
            isDefault: true,
          },
        ],
      },
    },
  });

  console.log(`Seed complete. User: ${defaultUser.id}, Series: ${defaultSeries.id}, Master Character: ${miloMaster.id}`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
