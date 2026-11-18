// Runs axe-core on the current page state. Usage from the driver:
//   $B eval tests/e2e/axe-run.js   then poll window.__axe
// Set window.__axeDark = true first to force the dark-theme colour tokens.
window.__axe = 'running';
(async () => {
  if (!window.axe) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = '/node_modules/axe-core/axe.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  if (window.__axeDark) {
    // Copy the declarations of the prefers-color-scheme: dark rule onto :root.
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule.media && /prefers-color-scheme:\s*dark/.test(rule.media.mediaText)) {
          for (const inner of rule.cssRules) {
            if (inner.selectorText === ':root') {
              for (const prop of inner.style) document.documentElement.style.setProperty(prop, inner.style.getPropertyValue(prop));
            }
          }
        }
      }
    }
  }
  const r = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  });
  window.__axe = JSON.stringify({
    violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ') + ' :: ' + n.failureSummary.split('\n').slice(1, 2).join('')) })),
    passes: r.passes.length,
    incomplete: r.incomplete.map((v) => v.id + '(' + v.nodes.length + ')'),
  });
})().catch((e) => (window.__axe = 'ERROR ' + e.message));
'started';
