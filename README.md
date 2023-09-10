## 🎈 Partykit ❤️ Replicache

Welcome to the party, pal!

This example shows how to implement Replicache's [Build Your Own Backend example](https://doc.replicache.dev/byob/intro). using [Partykit](https://partykit.io).

[`server.ts`](./src/server.ts) is the server-side code, which is responsible for handling WebSocket events and HTTP requests. [``](./src/client.ts) is the client-side code, which connects to the server and listens for events.

This uses PartyKit's realtime layer for sending Replicache's "poke" signal, the [HTTP Request Handler](https://docs.partykit.io/guides/responding-to-http-requests/) for responding to push or pull requests, and the [stateful Durable Object instance](https://docs.partykit.io/how-partykit-works/#stateful) for storing messages, client information, and the mutation version number.

Make sure you put in your own [Replicache license key](https://doc.replicache.dev/howto/licensing) in `client.tsx`. You can test it using the Replicache TEST_LICENSE_KEY, but they really want you to use your own key. They're free to generate to play around with it.

You can start developing by running `npm run dev` and opening [http://localhost:1999](http://localhost:1999) in your browser. When you're ready, you can deploy your application on to the PartyKit cloud with `npm run deploy`.

Refer to the PartyKit docs for more information: https://github.com/partykit/partykit/blob/main/README.md. For more help, reach out to us on [Discord](https://discord.gg/g5uqHQJc3z), [GitHub](https://github.com/partykit/partykit), or [Twitter](https://twitter.com/partykit_io).
