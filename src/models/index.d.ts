import { ModelInit, MutableModel, PersistentModelConstructor } from "@aws-amplify/datastore";

export enum LearningStatus {
  UNKNOWN = "UNKNOWN",
  LEARNING = "LEARNING",
  KNOWN = "KNOWN"
}



export declare class Word {
  readonly id: string;
  readonly stem: string;
  readonly variants?: string;
  readonly status?: LearningStatus | keyof typeof LearningStatus;
  constructor(init: ModelInit<Word>);
  static copyOf(source: Word, mutator: (draft: MutableModel<Word>) => MutableModel<Word> | void): Word;
}