export const handler = async (event) => {
  const title = event.outline.course.title;
  // si el flujo conoce lección actual, pásala aquí:
  const lessonId = event?.outline?.currentLessonId ?? null;

  const now = Date.now();
  const slug1 = `cheatsheet-${now}`;
  const slug2 = `practice-${now}`;

  return {
    items: [
      {
        slug: slug1,
        title: `Guía visual de ${title}`,
        resource_type: 'cheatsheet',          // 'article' | 'practice' | 'video' | 'cheatsheet' ...
        duration_minutes: 7,
        description: `Resumen gráfico de conceptos de ${title}.`,
        overview: `Esta guía cubre los puntos clave de ${title} con ejemplos.`,
        action_url: `https://app.novalearn.io/resources/${slug1}`,
        // opcional: indexar por lección
        ...(lessonId ? { lessonId } : {})
      },
      {
        slug: slug2,
        title: `Katas de ${title}`,
        resource_type: 'practice',
        duration_minutes: 45,
        description: `Ejercicios guiados para reforzar ${title}.`,
        overview: `Colección de 10 katas progresivas sobre ${title}.`,
        action_url: `https://app.novalearn.io/resources/${slug2}`,
        ...(lessonId ? { lessonId } : {})
      }
    ]
  };
};
