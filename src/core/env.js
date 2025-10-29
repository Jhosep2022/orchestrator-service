export const env = {
  provider: 'bedrock',
  bedrockModelId: process.env.BEDROCK_MODEL_ID,

  coursesTable: process.env.COURSES_TABLE_NAME,
  resourcesTable: process.env.RESOURCES_TABLE_NAME,

  eventBusName: process.env.EVENT_BUS_NAME || 'default',
  allowedOrigins: process.env.ALLOWED_ORIGINS || '*'
};
