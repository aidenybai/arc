// Minimal EventEmitter, modeled on Node's but only what Volt needs.

       

export class EventEmitter {
  #listeners = new Map();

  on(event , fn )  {
    let arr = this.#listeners.get(event);
    if (!arr) {
      arr = [];
      this.#listeners.set(event, arr);
    }
    arr.push({ fn, once: false });
    return this;
  }

  once(event , fn )  {
    let arr = this.#listeners.get(event);
    if (!arr) {
      arr = [];
      this.#listeners.set(event, arr);
    }
    arr.push({ fn, once: true });
    return this;
  }

  off(event , fn )  {
    if (!fn) {
      this.#listeners.delete(event);
      return this;
    }
    const arr = this.#listeners.get(event);
    if (arr) {
      const next = arr.filter((entry) => entry.fn !== fn);
      if (next.length === 0) this.#listeners.delete(event);
      else this.#listeners.set(event, next);
    }
    return this;
  }

  emit(event , ...args )  {
    const arr = this.#listeners.get(event);
    if (!arr || arr.length === 0) return false;
    const remaining = [];
    for (const entry of arr) {
      if (!entry.once) remaining.push(entry);
    }
    if (remaining.length === 0) this.#listeners.delete(event);
    else this.#listeners.set(event, remaining);
    for (const entry of arr.slice()) {
      entry.fn(...args);
    }
    return true;
  }

  listenerCount(event )  {
    const arr = this.#listeners.get(event);
    return arr ? arr.length : 0;
  }

  eventNames()  {
    const names = [];
    for (const key of this.#listeners.keys()) names.push(key);
    return names;
  }
}
