import type * as Party from "partykit/server";
import type { MessageWithID } from "./types";
import type { MutationV1, PatchOperation, PullResponse } from "replicache";

const SERVER_ID = 1;

export default class Server implements Party.Server {
  version = 1;
  messages: (MessageWithID & { version: number; deleted: boolean })[] = [];
  clients: {
    id: string;
    last_mutation_id: number;
    client_group_id: string;
    version: number;
  }[] = [];
  constructor(readonly party: Party.Party) {}

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // A websocket just connected!
    console.log(
      `Connected:
  id: ${conn.id}
  room: ${this.party.id}
  url: ${new URL(ctx.request.url).pathname}`
    );
  }

  async onRequest(request: Party.Request): Promise<Response> {
    if (request.method === "POST") {
      const isPush = new URL(request.url).searchParams.get("push") !== null;
      const isPull = new URL(request.url).searchParams.get("pull") !== null;
      if (isPush) {
        return await this.handlePush(request);
      }
      if (isPull) {
        return await this.handlePull(request);
      }
    }
    // if (request.method === "GET") {
    //   return new Response(JSON.stringify(this.messages));
    // }

    return new Response("Method not allowed", { status: 405 });
  }

  onMessage(message: string, sender: Party.Connection) {
    // let's log the message
    console.log(`connection ${sender.id} sent message: ${message}`);
    // as well as broadcast it to all the other connections in the room...
  }

  async sendPoke() {
    const t0 = Date.now();
    this.party.broadcast("poke", []);
    console.log("Sent poke in", Date.now() - t0);
  }

  async handlePush(request: Party.Request) {
    const t0 = Date.now();

    const push = await request.json<{
      mutations: MutationV1[];
      clientGroupID: string;
    }>();
    try {
      // Iterate each mutation in the push.
      for (const mutation of push.mutations) {
        const t1 = Date.now();

        try {
          this.processMutation(push.clientGroupID, mutation);
        } catch (e) {
          console.error("Caught error from mutation", mutation, e);

          // Handle errors inside mutations by skipping and moving on. This is
          // convenient in development but you may want to reconsider as your app
          // gets close to production:
          //
          // https://doc.replicache.dev/server-push#error-handling
          //
          // Ideally we would run the mutator itself in a nested transaction, and
          // if that fails, rollback just the mutator and allow the lmid and
          // version updates to commit. However, nested transaction support in
          // Postgres is not great:
          //
          // https://postgres.ai/blog/20210831-postgresql-subtransactions-considered-harmful
          //
          // Instead we implement skipping of failed mutations by *re-runing*
          // them, but passing a flag that causes the mutator logic to be skipped.
          //
          // This ensures that the lmid and version bookkeeping works exactly the
          // same way as in the happy path. A way to look at this is that for the
          // error-case we replay the mutation but it just does something
          // different the second time.
          //
          // This is allowed in Replicache because mutators don't have to be
          // deterministic!:
          //
          // https://doc.replicache.dev/concepts/how-it-works#speculative-execution-and-confirmation
          this.processMutation(push.clientGroupID, mutation, e as Error);
        }

        console.log("Processed mutation in", Date.now() - t1);
      }

      // We need to await here otherwise, Next.js will frequently kill the request
      // and the poke won't get sent.
      await this.sendPoke();
      return new Response("{}", { status: 200 });
    } catch (e) {
      console.error(e);
      if (e instanceof Response) return e;
      if (e instanceof Error)
        return new Response(e.toString(), { status: 500 });

      return new Response("Internal Server Error", { status: 500 });
    } finally {
      console.log("Processed push in", Date.now() - t0);
    }
  }
  async handlePull(request: Party.Request) {
    const pull = await request.json<{
      mutations: MutationV1[];
      clientGroupID: string;
      cookie: null | number;
      pullVersion: number;
      profileID: string;
    }>();

    const { clientGroupID } = pull;
    const fromVersion = pull.cookie ?? 0;
    const t0 = Date.now();

    try {
      return this.processPull(clientGroupID, fromVersion);
    } catch (e) {
      if (e instanceof Response) return e;
      if (e instanceof Error)
        return new Response(e.toString(), { status: 500 });

      return new Response("Internal Server Error", { status: 500 });
    } finally {
      console.log("Processed pull in", Date.now() - t0);
    }
  }

  async processMutation(
    clientGroupID: string,
    mutation: MutationV1,
    error?: Error | string | undefined
  ) {
    const { clientID } = mutation;

    const prevVersion = Number(this.version || 0);
    const nextVersion = prevVersion + 1;

    const lastMutationID = this.getLastMutationID(clientID);
    const nextMutationID = lastMutationID + 1;

    console.log("nextVersion", nextVersion, "nextMutationID", nextMutationID);

    // It's common due to connectivity issues for clients to send a
    // mutation which has already been processed. Skip these.
    if (mutation.id < nextMutationID) {
      console.log(
        `Mutation ${mutation.id} has already been processed - skipping`
      );
      return;
    }

    // If the Replicache client is working correctly, this can never
    // happen. If it does there is nothing to do but return an error to
    // client and report a bug to Replicache.
    if (mutation.id > nextMutationID) {
      throw new Error(
        `Mutation ${mutation.id} is from the future (current ID is ${nextMutationID}) - aborting. This can happen in development if the server restarts. In that case, clear appliation data in browser and refresh.`
      );
    }

    if (error === undefined) {
      console.log("Processing mutation:", JSON.stringify(mutation));

      // For each possible mutation, run the server-side logic to apply the
      // mutation.
      switch (mutation.name) {
        case "createMessage":
          this.createMessage(mutation.args as MessageWithID, nextVersion);
          break;
        default:
          throw new Error(`Unknown mutation: ${mutation.name}`);
      }
    } else {
      // TODO: You can store state here in the database to return to clients to
      // provide additional info about errors.
      console.log(
        "Handling error from mutation",
        JSON.stringify(mutation),
        error
      );
    }

    console.log("setting", clientID, "last_mutation_id to", nextMutationID);
    // Update lastMutationID for requesting client.
    await this.setLastMutationID(
      clientID,
      clientGroupID,
      nextMutationID,
      nextVersion
    );

    // Update global version.
    this.version = nextVersion;
  }

  processPull(clientGroupID: string, fromVersion: number) {
    if (fromVersion > this.version) {
      throw new Error(
        `fromVersion ${fromVersion} is from the future - aborting. This can happen in development if the server restarts. In that case, clear appliation data in browser and refresh.`
      );
    }

    // Get lmids for requesting client groups.
    const lastMutationIDChanges = this.getLastMutationIDChanges(
      clientGroupID,
      fromVersion
    );

    // Get changed domain objects since requested version.

    const changed = this.messages.filter((m) => m.version > fromVersion);

    // Build and return response.
    const patch: PatchOperation[] = [];
    for (const row of changed) {
      const { id, from, content, order, version: rowVersion, deleted } = row;
      if (deleted) {
        if (rowVersion > fromVersion) {
          patch.push({
            op: "del",
            key: `message/${id}`,
          });
        }
      } else {
        patch.push({
          op: "put",
          key: `message/${id}`,
          value: {
            from,
            content: content,
            order,
          },
        });
      }
    }

    const body: PullResponse = {
      lastMutationIDChanges: lastMutationIDChanges ?? {},
      cookie: this.version,
      patch,
    };
    return new Response(JSON.stringify(body), { status: 200 });
  }
  getLastMutationIDChanges(clientGroupID: string, fromVersion: number) {
    const clients = this.clients.filter(
      (c) => c.client_group_id === clientGroupID && c.version > fromVersion
    );

    return Object.fromEntries(clients.map((c) => [c.id, c.last_mutation_id]));
  }

  getLastMutationID(clientID: string) {
    const client = this.clients.find((c) => c.id === clientID);

    if (!client) {
      return 0;
    }
    return Number(client.last_mutation_id);
  }

  createMessage({ id, from, content, order }: MessageWithID, version: number) {
    this.messages.push({ id, from, content, order, deleted: false, version });
  }

  async setLastMutationID(
    clientID: string,
    clientGroupID: string,
    mutationID: number,
    version: number
  ) {
    let client = this.clients.find((c) => c.id === clientID);
    if (client) {
      client.client_group_id = clientGroupID;
      client.last_mutation_id = mutationID;
      client.version = version;
    } else {
      const client = {
        id: clientID,
        client_group_id: clientGroupID,
        last_mutation_id: mutationID,
        version,
      };
      this.clients.push(client);
      return;
    }
  }
}

Server satisfies Party.Worker;
