import data from "./h2-physics.topics.json";

export interface TopicLite {
  id: string;
  number: number;
  name: string;
  sectionId: string;
  outcomes: Record<string, string>;
}
export interface SectionLite {
  id: string;
  name: string;
  topicIds: string[];
}

export const SECTIONS: SectionLite[] = data.sections;
export const TOPICS = data.topics as unknown as TopicLite[];
export const TOPIC_BY_ID: Record<string, TopicLite> = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
export const topicName = (id: string | null | undefined) => (id ? TOPIC_BY_ID[id]?.name ?? id : "Unclassified");
