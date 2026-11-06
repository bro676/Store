/* Nexa text direction: bidi-aware without whole-document mutation rescans. */
(() => {
  const TEXT_SELECTOR = 'h1,h2,h3,h4,p,span,strong,small,label,th,td,li,summary,blockquote,figcaption,button,a,em,b,i,div,section,article';
  const CONTROL_SELECTOR = 'input,textarea,select';
  const EXCLUDED_SELECTOR = 'svg,script,style,code,pre,.ltr';
  const BATCH_SIZE = 180;
  const jobs = [];
  const queuedRoots = new Set();
  let activeJob = null;
  let frame = 0;
  let observer = null;

  function applyDirection(element) {
    if (!element || element.nodeType !== 1 || !element.matches) return;
    if (element.closest(EXCLUDED_SELECTOR)) return;

    if (element.matches(CONTROL_SELECTOR)) {
      if (!element.hasAttribute('dir')) element.setAttribute('dir', 'auto');
      return;
    }

    if (!element.matches(TEXT_SELECTOR) || element.hasAttribute('dir')) return;
    if (element.parentElement?.closest('[dir]:not([dir="auto"])')) return;
    if (['DIV', 'SECTION', 'ARTICLE'].includes(element.tagName) && element.children.length) {
      const hasDirectText = Array.from(element.childNodes).some(node => node.nodeType === 3 && node.textContent.trim());
      if (!hasDirectText) return;
    }
    element.setAttribute('dir', 'auto');
  }

  function createJob(root) {
    if (root?.nodeType === 3) root = root.parentElement;
    if (!root || root.nodeType !== 1) return null;
    return {
      root,
      walker: document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT),
      started: false
    };
  }

  function schedule() {
    if (frame || (!activeJob && jobs.length === 0)) return;
    const request = window.requestAnimationFrame || (callback => window.setTimeout(callback, 16));
    frame = request.call(window, flush);
  }

  function enqueue(root) {
    if (root?.nodeType === 3) root = root.parentElement;
    if (!root || root.nodeType !== 1 || queuedRoots.has(root)) return;
    const job = createJob(root);
    if (!job) return;
    queuedRoots.add(root);
    jobs.push(job);
    schedule();
  }

  function flush() {
    frame = 0;
    let budget = BATCH_SIZE;
    while (budget > 0) {
      if (!activeJob) {
        activeJob = jobs.shift() || null;
        if (!activeJob) break;
      }

      let element;
      if (!activeJob.started) {
        activeJob.started = true;
        element = activeJob.root;
      } else {
        element = activeJob.walker.nextNode();
      }

      if (!element) {
        queuedRoots.delete(activeJob.root);
        activeJob = null;
        continue;
      }

      applyDirection(element);
      budget--;
    }

    if (activeJob || jobs.length) schedule();
  }

  function start() {
    if (!document.body || observer) return;
    observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) enqueue(node);
          else if (node.nodeType === 3) enqueue(node.parentElement);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    enqueue(document.body);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
