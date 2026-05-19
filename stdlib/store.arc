// Arc Store — global reactive state shared across widgets
// Usage: import { createStore, useStore } from "arc/store"
//
// Problem: @state is scoped to a single page/widget.
// Store provides cross-widget reactive state — one source of truth.
//
// Example:
//   const cart = useStore("cart", { items: [], total: 0 })
//
//   // Reading:
//   text "Cart: {cart.get().items.length} items"
//
//   // Writing (updates all widgets using this store):
//   button on:click={ cart.set({ ...cart.get(), items: [...cart.get().items, item] }) }
//     "Add to cart"

// Internal: Map of store name → { value, subscribers }
// This is a module-level singleton — shared across all widgets
@state let _stores = {}

// Create or retrieve a store with a given name and initial value.
// If the store already exists, returns it (ignores initialValue).
fn createStore(name, initialValue) {
  unless _stores[name] {
    _stores[name] = {
      value: initialValue,
      subscribers: []
    }
  }
  return _storeHandle(name)
}

// Get an existing store (creates with undefined initial if not found)
fn useStore(name, initialValue) {
  return createStore(name, initialValue)
}

// Internal: creates the reactive handle returned to callers
fn _storeHandle(name) {
  return {
    get: fn() { return _stores[name].value },

    set: fn(newValue) {
      _stores[name].value = newValue
      for sub in _stores[name].subscribers {
        sub(newValue)
      }
    },

    update: fn(updater) {
      const next = updater(_stores[name].value)
      _storeHandle(name).set(next)
    },

    subscribe: fn(callback) {
      _stores[name].subscribers = [..._stores[name].subscribers, callback]
      return fn() {
        _stores[name].subscribers = _stores[name].subscribers.filter(fn(s) => s != callback)
      }
    }
  }
}

// Convenience: a counter store (common pattern)
fn createCounter(name, initial) {
  const store = createStore(name, initial ?? 0)
  return {
    get: fn() { return store.get() },
    increment: fn() { store.set(store.get() + 1) },
    decrement: fn() { store.set(store.get() - 1) },
    reset: fn() { store.set(initial ?? 0) },
    set: fn(n) { store.set(n) }
  }
}

// Convenience: a list store (common pattern)
fn createList(name, initial) {
  const store = createStore(name, initial ?? [])
  return {
    get: fn() { return store.get() },
    length: fn() { return store.get().length },
    add: fn(item) { store.set([...store.get(), item]) },
    remove: fn(predicate) { store.set(store.get().filter(fn(i) => !predicate(i))) },
    removeAt: fn(index) {
      store.set(store.get().filter(fn(_, i) => i != index))
    },
    update: fn(index, updater) {
      store.set(store.get().map(fn(item, i) => i == index ? updater(item) : item))
    },
    clear: fn() { store.set([]) },
    set: fn(items) { store.set(items) }
  }
}
