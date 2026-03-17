import { PIECE_ORDER } from "./pieces.js";

export class RandomBag {
  constructor() {
    this.queue = [];
  }

  next() {
    if (this.queue.length === 0) {
      this.refill();
    }
    return this.queue.shift();
  }

  refill() {
    const bag = [...PIECE_ORDER];
    for (let index = bag.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
    }
    this.queue.push(...bag);
  }
}
