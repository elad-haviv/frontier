/** A binary heap of (key, value) pairs, smallest key first: the queue of the flood and of A*. */
export class Heap {
  private keys: Float64Array;
  private values: Int32Array;
  size = 0;

  constructor(room = 1024) {
    this.keys = new Float64Array(room);
    this.values = new Int32Array(room);
  }

  push(key: number, value: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      const values = new Int32Array(this.size * 2);
      keys.set(this.keys);
      values.set(this.values);
      this.keys = keys;
      this.values = values;
    }
    const { keys, values } = this;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent]! <= key) break;
      keys[i] = keys[parent]!;
      values[i] = values[parent]!;
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }

  /** Takes the value with the smallest key; the heap must not be empty. */
  pop(): number {
    const { keys, values } = this;
    const top = values[0]!;
    const n = --this.size;
    if (n > 0) {
      const key = keys[n]!;
      const value = values[n]!;
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1]! < keys[child]!) child++;
        if (keys[child]! >= key) break;
        keys[i] = keys[child]!;
        values[i] = values[child]!;
        i = child;
      }
      keys[i] = key;
      values[i] = value;
    }
    return top;
  }
}
