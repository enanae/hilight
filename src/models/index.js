// @ts-check
import { initSchema } from '@aws-amplify/datastore';
import { schema } from './schema';

const LearningStatus = {
  "UNKNOWN": "UNKNOWN",
  "LEARNING": "LEARNING",
  "KNOWN": "KNOWN"
};

const { Word } = initSchema(schema);

export {
  Word,
  LearningStatus
};