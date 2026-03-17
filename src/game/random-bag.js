import { PIECE_ORDER } from "./pieces.js";

function hashSeed(seed) {
  const source = String(seed ?? "");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextState(state) {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

export class RandomBag {
  constructor(seed = "default-seed") {
    this.setSeed(seed);
  }

  setSeed(seed) {
    this.seed = String(seed);
    this.state = hashSeed(this.seed);
    this.queue = [];
  }

  nextRandom() {
    this.state = nextState(this.state);
    return this.state / 0x100000000;
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
      const swapIndex = Math.floor(this.nextRandom() * (index + 1));
      [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
    }
    this.queue.push(...bag);
  }

  exportState() {
    return {
      seed: this.seed,
      state: this.state,
      queue: [...this.queue],
    };
  }

  importState(snapshot) {
    this.seed = String(snapshot.seed);
    this.state = Number(snapshot.state) >>> 0;
    this.queue = Array.isArray(snapshot.queue) ? [...snapshot.queue] : [];
  }
}
