interface SocketLike {
  readyState: number;
  send(data: string): void;
}

const OPEN = 1;

export class ClientRegistry {
  private clients = new Set<SocketLike>();

  add(socket: SocketLike): void {
    this.clients.add(socket);
  }

  remove(socket: SocketLike): void {
    this.clients.delete(socket);
  }

  broadcast(event: unknown): void {
    const payload = JSON.stringify(event);
    for (const socket of this.clients) {
      if (socket.readyState === OPEN) socket.send(payload);
    }
  }
}
