// Runs while library.html is still being parsed, before any module: opens the history database and lets go of it at once. The
// browser then has it ready when db.js asks a few tens of milliseconds later, instead of opening it only then (opening a database
// of 5,000 shots takes about 40 ms, against 5 ms for ten; measured with `npm run bench`). It only reads: no version is asked
// for, and if the database does not exist yet the opening is aborted, so nothing is created and db.js stays the one that creates
// and upgrades it. A plain script, not a module: a module would wait for the others.
{
  const request = indexedDB.open('obturo');
  request.onupgradeneeded = () => request.transaction.abort();
  request.onsuccess = () => request.result.close();
  request.onerror = (event) => event.preventDefault();
}
