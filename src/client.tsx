import "./styles.css";
import { createRoot } from "react-dom/client";

import PartySocket from "partysocket";

import React, { type FormEvent, useRef } from "react";
import {
  Replicache,
  type WriteTransaction,
  TEST_LICENSE_KEY,
} from "replicache";
import { useSubscribe } from "replicache-react";
import { nanoid } from "nanoid";
import type { MessageWithID, Message } from "./types";

declare const PARTYKIT_HOST: string;
const PARTY_NAME = "main";
const ROOM_NAME = "replicache-party";

// A PartySocket is like a WebSocket, except it's a bit more magical.
// It handles reconnection logic, buffering messages while it's offline, and more.
const conn = new PartySocket({
  host: PARTYKIT_HOST,
  room: ROOM_NAME,
});

const rep =
  typeof window !== "undefined"
    ? new Replicache({
        name: "chat-user-id",
        licenseKey: TEST_LICENSE_KEY,
        pushURL: `/parties/${PARTY_NAME}/${ROOM_NAME}?push`,
        pullURL: `/parties/${PARTY_NAME}/${ROOM_NAME}?pull`,

        mutators: {
          async createMessage(
            tx: WriteTransaction,
            { id, from, content, order }: MessageWithID
          ) {
            await tx.put(`message/${id}`, {
              from,
              content,
              order,
            });
          },
        },
      })
    : null!;

// Clear the existing HTML content
document.body.innerHTML = '<div id="app"></div>';

// Render your React component instead
const root = createRoot(document.getElementById("app")!);
root.render(<Home />);

export default function Home() {
  const messages = useSubscribe(
    rep,
    async (tx) => {
      const list = (await tx
        .scan({ prefix: "message/" })
        .entries()
        .toArray()) as [string, Message][];
      list.sort(([, { order: a }], [, { order: b }]) => a - b);
      return list;
    },
    []
  );

  const usernameRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLInputElement>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!usernameRef.current) return;
    if (!contentRef.current) return;
    const last = messages[messages.length - 1]?.[1];
    const order = (last?.order ?? 0) + 1;

    rep.mutate.createMessage({
      id: nanoid(),
      from: usernameRef.current.value,
      content: contentRef.current.value,
      order,
    });
    contentRef.current.value = "";
  };

  return (
    <div>
      <form onSubmit={onSubmit}>
        <input ref={usernameRef} required /> says:{" "}
        <input ref={contentRef} required /> <input type="submit" />
      </form>
      <MessageList messages={messages} />
    </div>
  );
}

function MessageList({ messages }: { messages: [string, Message][] }) {
  return messages.map(([k, v]) => {
    return (
      <div key={k}>
        <b>{v.from}: </b>
        {v.content}
      </div>
    );
  });
}

// You can even start sending messages before the connection is open!
conn.addEventListener("message", (event) => {
  if (event.data === "poke") {
    if (!rep) return;
    rep.pull();
  }
});

// Let's listen for when the connection opens
conn.addEventListener("open", () => {});
