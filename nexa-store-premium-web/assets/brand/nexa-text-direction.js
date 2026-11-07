/* Nexa direction helper v3: document direction drives layout; only editable controls use auto-bidi. */
(() => {
  'use strict';
  const CONTROL_SELECTOR = 'input,textarea';
  const NUMERIC_SELECTOR = 'input[type="number"],input[inputmode="numeric"],input[inputmode="decimal"],input[inputmode="tel"],input[type="email"],input[type="url"]';
  const EXCLUDED_SELECTOR = 'script,style,code,pre,.ltr,[dir="ltr"]';
  const BATCH_SIZE = 220;
  const jobs = [];
  const queuedRoots = new Set();
  let activeJob = null;
  let frame = 0;
  let observer = null;
  function applyDirection(element) {
    if (!element || element.nodeType !== 1 || !element.matches || element.matches(EXCLUDED_SELECTOR)) return;
    if (element.matches(NUMERIC_SELECTOR)) {
      if (!element.hasAttribute('dir')) element.setAttribute('dir', 'ltr');
      return;
    }
    if (element.matches(CONTROL_SELECTOR) && !element.hasAttribute('dir')) element.setAttribute('dir', 'auto');
    // Text, buttons and flex containers inherit html[dir]; never assign dir=auto to layout nodes.
  }
  function createJob(root) {
    if (root && root.nodeType === 3) root = root.parentElement;
    if (!root || root.nodeType !== 1) return null;
    return {root, walker: document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT), started: false};
  }
  function schedule() {
    if (frame || (!activeJob && jobs.length === 0)) return;
    const request = window.requestAnimationFrame || (callback => window.setTimeout(callback, 16));
    frame = request.call(window, flush);
  }
  function enqueue(root) {
    if (root && root.nodeType === 3) root = root.parentElement;
    if (!root || root.nodeType !== 1 || queuedRoots.has(root)) return;
    const job = createJob(root);
    if (!job) return;
    queuedRoots.add(root); jobs.push(job); schedule();
  }
  function flush() {
    frame = 0; let budget = BATCH_SIZE;
    while (budget > 0) {
      if (!activeJob) { activeJob = jobs.shift() || null; if (!activeJob) break; }
      let element;
      if (!activeJob.started) { activeJob.started = true; element = activeJob.root; }
      else element = activeJob.walker.nextNode();
      if (!element) { queuedRoots.delete(activeJob.root); activeJob = null; continue; }
      applyDirection(element); budget--;
    }
    if (activeJob || jobs.length) schedule();
  }
  function start() {
    if (!document.body || observer) return;
    observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1) enqueue(node); else if (node.nodeType === 3) enqueue(node.parentElement);
      }
    });
    observer.observe(document.body, {childList:true, subtree:true}); enqueue(document.body);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, {once:true});
})();
