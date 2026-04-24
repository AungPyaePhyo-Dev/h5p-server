import { Writable } from 'stream';
import * as yazl from 'yazl';

export type Choice = { id: string; text: string };
export type Question = {
  id: string;
  prompt: string;
  choices: Choice[];
  correctChoiceId: string;
};

export type QuizPayload = {
  id: string;
  title: string;
  description: string;
  passThreshold: number;
  questions: Question[];
};

/**
 * Stream a SCORM 1.2 zip for a custom quiz to `out`. The zip contains:
 *   - imsmanifest.xml     SCORM 1.2 manifest, masteryscore = passThreshold
 *   - index.html          self-contained quiz UI + SCORM API calls
 *   - quiz.json           question data, loaded by index.html at runtime
 */
export function exportQuizScorm(quiz: QuizPayload, out: Writable): void {
  const zip = new yazl.ZipFile();
  zip.outputStream.pipe(out);

  const identifier = `QUIZ_${quiz.id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  zip.addBuffer(
    Buffer.from(buildManifest(identifier, quiz.title, quiz.passThreshold)),
    'imsmanifest.xml',
  );
  zip.addBuffer(Buffer.from(buildIndexHtml(quiz.title)), 'index.html');
  zip.addBuffer(Buffer.from(JSON.stringify(quiz)), 'quiz.json');

  zip.end();
}

function buildManifest(identifier: string, title: string, mastery: number): string {
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
        <title>${escapeXml(title)}</title>
        <adlcp:masteryscore>${mastery}</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
      <file href="quiz.json"/>
    </resource>
  </resources>
</manifest>
`;
}

function buildIndexHtml(title: string): string {
  // Inlined quiz UI. SCORM 1.2 API discovered on window.parent, reports
  // raw score 0-100 and lesson_status based on passThreshold.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; color: #222; }
    h1 { margin-top: 0; }
    .q { border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin: 12px 0; }
    .q p { margin: 0 0 8px; font-weight: 600; }
    label { display: block; padding: 6px 0; cursor: pointer; }
    label:hover { background: #f6f6f6; }
    button { padding: 10px 20px; font-size: 16px; cursor: pointer; border-radius: 6px; border: 1px solid #333; background: #333; color: #fff; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .result { padding: 16px; border-radius: 8px; margin-top: 16px; font-size: 18px; }
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
    function lmsReport(score, passed) {
      if (!api) return;
      try {
        api.LMSSetValue('cmi.core.score.raw', String(score));
        api.LMSSetValue('cmi.core.score.min', '0');
        api.LMSSetValue('cmi.core.score.max', '100');
        api.LMSSetValue('cmi.core.lesson_status', passed ? 'passed' : 'failed');
        api.LMSCommit('');
      } catch (e) {}
    }
    function lmsFinish() {
      if (!api) return;
      try { api.LMSFinish(''); } catch (e) {}
    }
    window.addEventListener('beforeunload', lmsFinish);

    // ---- Load quiz ----
    lmsInit();
    fetch('quiz.json').then(function (r) { return r.json(); }).then(render).catch(function (e) {
      document.getElementById('app').innerText = 'Failed to load quiz: ' + e;
    });

    function render(quiz) {
      var app = document.getElementById('app');
      app.innerHTML = '';
      var h = document.createElement('h1'); h.textContent = quiz.title; app.appendChild(h);
      if (quiz.description) {
        var d = document.createElement('p'); d.className = 'muted'; d.textContent = quiz.description; app.appendChild(d);
      }
      var form = document.createElement('form'); app.appendChild(form);
      quiz.questions.forEach(function (q, idx) {
        var card = document.createElement('div'); card.className = 'q';
        var prompt = document.createElement('p'); prompt.textContent = (idx + 1) + '. ' + q.prompt; card.appendChild(prompt);
        q.choices.forEach(function (c) {
          var label = document.createElement('label');
          var input = document.createElement('input');
          input.type = 'radio'; input.name = q.id; input.value = c.id;
          label.appendChild(input);
          label.appendChild(document.createTextNode(' ' + c.text));
          card.appendChild(label);
        });
        form.appendChild(card);
      });
      var btn = document.createElement('button'); btn.type = 'submit'; btn.textContent = 'Submit'; form.appendChild(btn);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var correct = 0;
        quiz.questions.forEach(function (q) {
          var picked = form.elements[q.id] ? form.elements[q.id].value : null;
          if (picked && picked === q.correctChoiceId) correct++;
        });
        var total = quiz.questions.length || 1;
        var score = Math.round((correct / total) * 100);
        var passed = score >= (quiz.passThreshold || 0);
        lmsReport(score, passed);

        var result = document.createElement('div');
        result.className = 'result ' + (passed ? 'pass' : 'fail');
        result.textContent = (passed ? 'Passed' : 'Failed') +
          ' — ' + correct + '/' + total + ' correct (' + score + '%, pass at ' + (quiz.passThreshold || 0) + '%)';
        app.appendChild(result);
        btn.disabled = true;
        Array.prototype.forEach.call(form.querySelectorAll('input'), function (i) { i.disabled = true; });
      });
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
