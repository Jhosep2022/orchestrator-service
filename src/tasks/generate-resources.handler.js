export const handler = async (event) => {
  const title = event.outline.course.title;
  // IA mock: 2 recursos
  return {
    items: [
      {
        slug: `cheatsheet-${Date.now()}`,
        title: `Guía visual de ${title}`,
        resource_type: 'cheatsheet',
        duration_minutes: 7,
        description: `Resumen gráfico de conceptos de ${title}.`
      },
      {
        slug: `practice-${Date.now()}`,
        title: `Katas de ${title}`,
        resource_type: 'practice',
        duration_minutes: 45,
        description: `Ejercicios guiados para reforzar ${title}.`
      }
    ]
  };
};
