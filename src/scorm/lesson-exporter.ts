import * as fs from 'fs';
import * as path from 'path';
import { Writable } from 'stream';
import * as yazl from 'yazl';

export type TextBlock = { id: string; type: 'text'; title: string; body: string };
export type ImageBlock = {
  id: string;
  type: 'image';
  caption: string;
  src: { kind: 'upload'; filename: string };
};
export type VideoBlock = {
  id: string;
  type: 'video';
  src:
    | { kind: 'upload'; filename: string }
    | { kind: 'url'; url: string };
};
export type QuizChoice = { id: string; text: string };
export type QuizQuestion = {
  id: string;
  prompt: string;
  choices: QuizChoice[];
  correctChoiceId: string;
};
export type QuizBlock = {
  id: string;
  type: 'quiz';
  passThreshold: number;
  questions: QuizQuestion[];
};
export type Hotspot = { id: string; x: number; y: number; title: string; body: string };
export type HotspotBlock = {
  id: string;
  type: 'hotspot';
  src: { kind: 'upload'; filename: string };
  hotspots: Hotspot[];
  requireAll: boolean;
};
export type Block = TextBlock | ImageBlock | VideoBlock | QuizBlock | HotspotBlock;

export type LessonPayload = {
  id: string;
  title: string;
  description: string;
  blocks: Block[];
};

/**
 * Stream a SCORM 1.2 zip for a multi-block lesson. The zip contains:
 *   - imsmanifest.xml    SCORM 1.2 manifest
 *   - index.html         lesson runtime (navigates blocks, reports SCORM status)
 *   - lesson.json        lesson payload (blocks with paths rewritten to assets/…)
 *   - assets/<files>     copied from assetsDir for upload-kind image/video blocks
 */
export function exportLessonScorm(
  lesson: LessonPayload,
  assetsDir: string,
  out: Writable,
): void {
  const zip = new yazl.ZipFile();
  zip.outputStream.pipe(out);

  // Deep-clone and rewrite asset references so the exported lesson.json
  // points at `assets/<filename>` (zip-relative) regardless of where the
  // originals live on disk.
  const exported: LessonPayload = {
    ...lesson,
    blocks: lesson.blocks.map((b) => rewriteBlockForExport(b)),
  };

  const identifier = `LESSON_${lesson.id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const quizMastery = computeQuizMastery(lesson.blocks);

  zip.addBuffer(
    Buffer.from(buildManifest(identifier, lesson.title, quizMastery)),
    'imsmanifest.xml',
  );
  zip.addBuffer(Buffer.from(buildIndexHtml(lesson.title)), 'index.html');
  zip.addBuffer(Buffer.from(JSON.stringify(exported)), 'lesson.json');

  // Bundle uploaded assets. Only `kind: 'upload'` blocks have local files.
  for (const block of lesson.blocks) {
    const filename = uploadFilenameFor(block);
    if (!filename) continue;
    const abs = path.join(assetsDir, filename);
    if (fs.existsSync(abs)) {
      zip.addFile(abs, `assets/${filename}`);
    }
  }

  zip.end();
}

function rewriteBlockForExport(b: Block): Block {
  if (b.type === 'image') {
    return { ...b, src: { kind: 'upload', filename: b.src.filename } };
  }
  if (b.type === 'video' && b.src.kind === 'upload') {
    return { ...b, src: { kind: 'upload', filename: b.src.filename } };
  }
  return b;
}

function uploadFilenameFor(b: Block): string | null {
  if (b.type === 'image') return b.src.filename;
  if (b.type === 'video' && b.src.kind === 'upload') return b.src.filename;
  if (b.type === 'hotspot') return b.src.filename;
  return null;
}

function computeQuizMastery(blocks: Block[]): number | null {
  // If there's at least one quiz block, report the average threshold as the
  // SCO's masteryscore. If no quizzes, omit masteryscore — the SCO will
  // simply report `completed` when the learner reaches the last block.
  const qs = blocks.filter((b): b is QuizBlock => b.type === 'quiz');
  if (qs.length === 0) return null;
  const sum = qs.reduce((acc, q) => acc + (q.passThreshold || 0), 0);
  return Math.round(sum / qs.length);
}

function buildManifest(identifier: string, title: string, mastery: number | null): string {
  const masteryTag = mastery != null ? `\n        <adlcp:masteryscore>${mastery}</adlcp:masteryscore>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${identifier}" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${escapeXml(title)}</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>${escapeXml(title)}</title>${masteryTag}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
      <file href="lesson.json"/>
    </resource>
  </resources>
</manifest>
`;
}

function buildIndexHtml(title: string): string {
  // Self-contained lesson player: renders blocks one at a time with
  // Previous/Next. Completion requires reaching the last block (and passing
  // all quiz blocks). Reports score = average quiz score, or 100 if no
  // quizzes and the learner finished.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 24px; color: #222; }
    h1 { margin-top: 0; }
    .block { min-height: 240px; padding: 20px 0; }
    .nav { display: flex; gap: 8px; align-items: center; border-top: 1px solid #eee; padding-top: 12px; }
    .nav .spacer { flex: 1; }
    .progress { color: #666; font-size: 14px; }
    button { padding: 10px 18px; font-size: 15px; cursor: pointer; border-radius: 6px; border: 1px solid #333; background: #333; color: #fff; }
    button.secondary { background: #fff; color: #333; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    img.block-img { max-width: 100%; border-radius: 6px; }
    video.block-vid { max-width: 100%; border-radius: 6px; background: #000; }
    iframe.block-vid { width: 100%; aspect-ratio: 16/9; border: 0; border-radius: 6px; }
    .caption { color: #555; font-size: 14px; margin-top: 6px; }
    .rt-body { font-size: 15px; line-height: 1.55; }
    .rt-body p { margin: 0 0 0.6em; }
    .rt-body h2 { font-size: 20px; margin: 0.6em 0 0.4em; }
    .rt-body h3 { font-size: 17px; margin: 0.6em 0 0.3em; }
    .rt-body ul, .rt-body ol { padding-left: 1.4em; margin: 0.2em 0 0.6em; }
    .rt-body li { margin: 0.15em 0; }
    .rt-body blockquote { border-left: 3px solid #ddd; margin: 0.4em 0; padding: 0.2em 0.8em; color: #555; }
    .rt-body a { color: #0969da; }
    .rt-body code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 0.92em; }
    .rt-body pre { background: #f4f4f4; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
    .hs-wrap { position: relative; display: inline-block; max-width: 100%; }
    .hs-wrap img { max-width: 100%; display: block; border-radius: 6px; }
    .hs-marker {
      position: absolute; transform: translate(-50%, -50%);
      width: 30px; height: 30px; border-radius: 50%;
      background: #0969da; color: #fff; font-weight: 700; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      border: 2px solid #fff; user-select: none;
      transition: transform 0.15s;
    }
    .hs-marker:hover { transform: translate(-50%, -50%) scale(1.15); }
    .hs-marker.viewed { background: #2ea44f; }
    .hs-pop {
      position: absolute; transform: translate(-50%, calc(-100% - 20px));
      background: #fff; border: 1px solid #ccc; border-radius: 8px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.2);
      padding: 12px 14px; min-width: 220px; max-width: 320px; z-index: 5;
    }
    .hs-pop h4 { margin: 0 0 6px; font-size: 15px; }
    .hs-pop p { margin: 0; font-size: 14px; color: #333; white-space: pre-wrap; }
    .hs-pop .close { position: absolute; top: 4px; right: 6px; border: 0; background: transparent; cursor: pointer; font-size: 16px; color: #888; padding: 2px 6px; }
    .hs-progress { color: #666; font-size: 14px; margin-top: 8px; }
    .q { border: 1px solid #e5e5e5; border-radius: 8px; padding: 14px; margin: 10px 0; }
    .q p.prompt { margin: 0 0 8px; font-weight: 600; }
    label { display: block; padding: 6px 0; cursor: pointer; }
    label:hover { background: #f6f6f6; }
    .result { padding: 12px 16px; border-radius: 8px; margin-top: 12px; font-size: 16px; }
    .pass { background: #e7f7ec; border: 1px solid #2ea44f; }
    .fail { background: #fbeaea; border: 1px solid #cf222e; }
    .muted { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div id="app">Loading…</div>
  <script>
  (function () {
    // ---- SCORM 1.2 API discovery ----
    function findAPI(win) {
      var tries = 0;
      while (win && !win.API && win.parent && win.parent !== win && tries < 10) {
        tries++; win = win.parent;
      }
      return win ? win.API : null;
    }
    var api = findAPI(window) || (window.opener ? findAPI(window.opener) : null);
    function lmsInit() {
      if (!api) return;
      try {
        api.LMSInitialize('');
        api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
        api.LMSCommit('');
      } catch (e) {}
    }
    function lmsReport(score, status) {
      if (!api) return;
      try {
        if (typeof score === 'number') {
          api.LMSSetValue('cmi.core.score.raw', String(score));
          api.LMSSetValue('cmi.core.score.min', '0');
          api.LMSSetValue('cmi.core.score.max', '100');
        }
        api.LMSSetValue('cmi.core.lesson_status', status);
        api.LMSCommit('');
      } catch (e) {}
    }
    window.addEventListener('beforeunload', function () {
      if (!api) return; try { api.LMSFinish(''); } catch (e) {}
    });
    lmsInit();

    // ---- Load lesson ----
    fetch('lesson.json').then(function (r) { return r.json(); }).then(start).catch(function (e) {
      document.getElementById('app').innerText = 'Failed to load lesson: ' + e;
    });

    function start(lesson) {
      var app = document.getElementById('app');
      var blocks = lesson.blocks || [];
      // Map of quiz blockId -> { score, passed, passThreshold }. Until the
      // learner submits a quiz, it is absent (treated as not yet attempted).
      var quizResults = {};
      // blockId -> { hotspotId: true } for hotspot blocks; persists across re-renders.
      var hotspotViewed = {};
      var visited = new Array(blocks.length).fill(false);
      var idx = 0;

      function render() {
        app.innerHTML = '';
        var title = document.createElement('h1'); title.textContent = lesson.title; app.appendChild(title);
        if (lesson.description) {
          var d = document.createElement('p'); d.className = 'muted'; d.textContent = lesson.description; app.appendChild(d);
        }
        var container = document.createElement('div'); container.className = 'block'; app.appendChild(container);
        visited[idx] = true;
        renderBlock(blocks[idx], container);

        var nav = document.createElement('div'); nav.className = 'nav';
        var prev = document.createElement('button'); prev.className = 'secondary'; prev.textContent = '← Previous'; prev.disabled = idx === 0;
        prev.onclick = function () { idx--; render(); };
        var progress = document.createElement('span'); progress.className = 'progress'; progress.textContent = (idx + 1) + ' / ' + blocks.length;
        var spacer = document.createElement('span'); spacer.className = 'spacer';
        var next = document.createElement('button'); next.textContent = idx === blocks.length - 1 ? 'Finish' : 'Next →';
        next.onclick = function () {
          var current = blocks[idx];
          if (current && current.type === 'hotspot' && current.requireAll) {
            var total = (current.hotspots || []).length;
            var seen = 0;
            var vm = hotspotViewed[current.id] || {};
            (current.hotspots || []).forEach(function (h) { if (vm[h.id]) seen++; });
            if (seen < total) { alert('Please explore all hotspots before continuing.'); return; }
          }
          if (idx === blocks.length - 1) finish();
          else { idx++; render(); }
        };
        nav.appendChild(prev);
        nav.appendChild(spacer);
        nav.appendChild(progress);
        nav.appendChild(next);
        app.appendChild(nav);
      }

      function renderBlock(block, host) {
        if (!block) { host.textContent = '(empty block)'; return; }
        if (block.type === 'text') {
          if (block.title) {
            var h = document.createElement('h2'); h.textContent = block.title; host.appendChild(h);
          }
          // body is rich-text HTML produced by the authoring Tiptap editor.
          var p = document.createElement('div'); p.className = 'rt-body';
          p.innerHTML = block.body || '';
          host.appendChild(p);
          return;
        }
        if (block.type === 'image') {
          var img = document.createElement('img'); img.className = 'block-img';
          img.src = 'assets/' + encodeURIComponent(block.src.filename);
          img.alt = block.caption || '';
          host.appendChild(img);
          if (block.caption) {
            var cap = document.createElement('div'); cap.className = 'caption'; cap.textContent = block.caption;
            host.appendChild(cap);
          }
          return;
        }
        if (block.type === 'video') {
          if (block.src.kind === 'upload') {
            var v = document.createElement('video'); v.className = 'block-vid'; v.controls = true;
            v.src = 'assets/' + encodeURIComponent(block.src.filename);
            host.appendChild(v);
          } else {
            var url = block.src.url || '';
            var embed = toEmbed(url);
            if (embed) {
              var f = document.createElement('iframe'); f.className = 'block-vid';
              f.src = embed; f.allowFullscreen = true;
              f.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
              host.appendChild(f);
            } else {
              var v2 = document.createElement('video'); v2.className = 'block-vid'; v2.controls = true;
              v2.src = url;
              host.appendChild(v2);
            }
          }
          return;
        }
        if (block.type === 'quiz') {
          renderQuiz(block, host);
          return;
        }
        if (block.type === 'hotspot') {
          renderHotspot(block, host);
          return;
        }
        host.textContent = '(unsupported block type: ' + block.type + ')';
      }

      function renderHotspot(block, host) {
        var wrap = document.createElement('div'); wrap.className = 'hs-wrap';
        var img = document.createElement('img');
        img.src = 'assets/' + encodeURIComponent(block.src.filename);
        wrap.appendChild(img);
        if (!hotspotViewed[block.id]) hotspotViewed[block.id] = {};
        var viewedMap = hotspotViewed[block.id];
        (block.hotspots || []).forEach(function (h, i) {
          var m = document.createElement('div');
          m.className = 'hs-marker' + (viewedMap[h.id] ? ' viewed' : '');
          m.style.left = h.x + '%';
          m.style.top = h.y + '%';
          m.textContent = String(i + 1);
          m.addEventListener('click', function (e) {
            e.stopPropagation();
            closeOpenPopovers();
            var pop = document.createElement('div'); pop.className = 'hs-pop';
            pop.style.left = h.x + '%';
            pop.style.top = h.y + '%';
            if (h.title) {
              var t = document.createElement('h4'); t.textContent = h.title; pop.appendChild(t);
            }
            var p = document.createElement('p'); p.textContent = h.body || ''; pop.appendChild(p);
            var x = document.createElement('button'); x.className = 'close'; x.textContent = '×';
            x.addEventListener('click', function (e2) { e2.stopPropagation(); pop.remove(); });
            pop.appendChild(x);
            wrap.appendChild(pop);
            viewedMap[h.id] = true;
            m.classList.add('viewed');
            updateProgress();
          });
          wrap.appendChild(m);
        });
        host.appendChild(wrap);

        var progress = document.createElement('div'); progress.className = 'hs-progress';
        host.appendChild(progress);
        updateProgress();

        function updateProgress() {
          var total = (block.hotspots || []).length;
          var seen = 0;
          (block.hotspots || []).forEach(function (h) { if (viewedMap[h.id]) seen++; });
          progress.textContent = seen + ' / ' + total + ' explored' +
            (block.requireAll && seen < total ? ' — explore all to continue' : '');
        }

        // Dismiss any open popover when clicking empty image area.
        wrap.addEventListener('click', function () { closeOpenPopovers(); });
        function closeOpenPopovers() {
          Array.prototype.forEach.call(wrap.querySelectorAll('.hs-pop'), function (n) { n.remove(); });
        }
      }

      function renderQuiz(block, host) {
        var form = document.createElement('form');
        (block.questions || []).forEach(function (q, qi) {
          var card = document.createElement('div'); card.className = 'q';
          var prompt = document.createElement('p'); prompt.className = 'prompt';
          prompt.textContent = (qi + 1) + '. ' + q.prompt; card.appendChild(prompt);
          (q.choices || []).forEach(function (c) {
            var label = document.createElement('label');
            var input = document.createElement('input');
            input.type = 'radio'; input.name = q.id; input.value = c.id;
            label.appendChild(input);
            label.appendChild(document.createTextNode(' ' + c.text));
            card.appendChild(label);
          });
          form.appendChild(card);
        });
        var existing = quizResults[block.id];
        var btn = document.createElement('button'); btn.type = 'submit';
        btn.textContent = existing ? 'Retake' : 'Submit answers';
        form.appendChild(btn);
        host.appendChild(form);

        if (existing) {
          var banner = document.createElement('div');
          banner.className = 'result ' + (existing.passed ? 'pass' : 'fail');
          banner.textContent = (existing.passed ? 'Passed' : 'Failed') +
            ' — ' + existing.score + '% (pass at ' + block.passThreshold + '%)';
          host.appendChild(banner);
        }

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var correct = 0; var total = (block.questions || []).length || 1;
          (block.questions || []).forEach(function (q) {
            var picked = form.elements[q.id] ? form.elements[q.id].value : null;
            if (picked && picked === q.correctChoiceId) correct++;
          });
          var score = Math.round((correct / total) * 100);
          var passed = score >= (block.passThreshold || 0);
          quizResults[block.id] = { score: score, passed: passed };
          // Rerender so the result banner shows.
          render();
        });
      }

      function toEmbed(url) {
        // YouTube
        var yt = url.match(/(?:youtube\\.com\\/(?:watch\\?v=|embed\\/|shorts\\/)|youtu\\.be\\/)([\\w-]{6,})/);
        if (yt) return 'https://www.youtube.com/embed/' + yt[1];
        // Vimeo
        var vm = url.match(/vimeo\\.com\\/(?:video\\/)?(\\d+)/);
        if (vm) return 'https://player.vimeo.com/video/' + vm[1];
        return null;
      }

      function finish() {
        var allVisited = visited.every(Boolean);
        var quizBlocks = blocks.filter(function (b) { return b.type === 'quiz'; });
        var attempted = quizBlocks.filter(function (b) { return quizResults[b.id]; });
        var allQuizzesDone = attempted.length === quizBlocks.length;
        var hotspotBlocks = blocks.filter(function (b) { return b.type === 'hotspot' && b.requireAll; });
        var allHotspotsDone = hotspotBlocks.every(function (b) {
          var vm = hotspotViewed[b.id] || {};
          return (b.hotspots || []).every(function (h) { return vm[h.id]; });
        });

        if (!allVisited || !allQuizzesDone || !allHotspotsDone) {
          alert(!allQuizzesDone ? 'Please complete all quizzes before finishing.'
            : !allHotspotsDone ? 'Please explore all required hotspots before finishing.'
            : 'Please view all blocks before finishing.');
          return;
        }

        var status, score;
        if (quizBlocks.length > 0) {
          var total = quizBlocks.reduce(function (acc, b) { return acc + quizResults[b.id].score; }, 0);
          score = Math.round(total / quizBlocks.length);
          var allPassed = quizBlocks.every(function (b) { return quizResults[b.id].passed; });
          status = allPassed ? 'passed' : 'failed';
        } else {
          score = 100;
          status = 'completed';
        }
        lmsReport(score, status);

        app.innerHTML = '';
        var h = document.createElement('h1'); h.textContent = 'Lesson complete'; app.appendChild(h);
        var r = document.createElement('div'); r.className = 'result ' + (status === 'failed' ? 'fail' : 'pass');
        r.textContent = status === 'failed'
          ? 'You did not pass. Score: ' + score + '%.'
          : 'Nice work! ' + (quizBlocks.length > 0 ? ('Score: ' + score + '%.') : '');
        app.appendChild(r);
      }

      render();
    }
  })();
  </script>
</body>
</html>
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
