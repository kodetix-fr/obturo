// IndexedDB requests and transactions as promises. Shared by the two databases (db.js, settings.js); nothing else.

/** @template T @param {IDBRequest<T>} r @returns {Promise<T>} */
export const wait = (r) => new Promise((ok, ko) => {
  r.onsuccess = () => ok(r.result);
  r.onerror = () => ko(r.error);
});

/** Resolves when the transaction is committed, rejects when it fails or is aborted. @param {IDBTransaction} tx @returns {Promise<void>} */
export const done = (tx) => new Promise((ok, ko) => {
  tx.oncomplete = () => ok();
  tx.onerror = tx.onabort = () => ko(tx.error);
});
