export const handler = async (event) => {
  const { items } = event.lessons;
  // IA mock: 1 pregunta por lección para el examen final
  let pos = 1;
  const questions = items.map((l) => ({
    id: `ex_q${pos++}`,
    prompt: `Pregunta general sobre ${l.title}`,
    options: [
      { key: 'A', label: 'Respuesta correcta', isCorrect: true,  feedback: 'Correcto' },
      { key: 'B', label: 'Distractor',         isCorrect: false, feedback: 'No es correcto' }
    ]
  }));
  return { items: questions, meta: { mode: 'final', timeLimitMinutes: 20 } };
};
