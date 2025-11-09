export const handler = async (event) => {
  const { items } = event.lessons;
  // IA mock: 1 pregunta por lección
  const quizzes = items.map((l) => ({
    lessonId: l.id,
    questions: [
      {
        id: `${l.id}_q1`,
        position: 1,
        prompt: `¿Concepto clave de "${l.title}"?`,
        options: [
          { key: 'A', label: 'Opción correcta', isCorrect: true,  feedback: 'Bien!' },
          { key: 'B', label: 'Distractor',      isCorrect: false, feedback: 'Revisa el concepto.' }
        ]
      }
    ]
  }));
  return { items: quizzes };
};
