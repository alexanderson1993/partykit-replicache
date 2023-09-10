export type Message = {
  from: string;
  content: string;
  order: number;
};

export type MessageWithID = Message & { id: string };
