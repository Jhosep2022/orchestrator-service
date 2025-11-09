export const handler = async (event) => {
  const { lessons } = event.outline;
  // IA mock: genera contenido Markdown por lección
  const enriched = lessons.map((l) => ({
    ...l,
    contentMD: `# ${l.title}\n\nExplicación breve...\n\n\`\`\`python\nprint("demo")\n\`\`\`\n`,
    summary: `Resumen de ${l.title}.`
  }));
  return { items: enriched };
};
