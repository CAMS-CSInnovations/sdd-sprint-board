/**
 * SDD Capstone Sprint Board — backend
 *
 * SETUP (see README.md for full walkthrough):
 * 1. Create a new Google Sheet.
 * 2. Extensions > Apps Script, delete the sample code, paste this whole file in.
 * 3. Set TEACHER_EMAIL below to your email address.
 * 4. Deploy > New deployment > Web app.
 *      Execute as: Me
 *      Who has access: Anyone
 * 5. Copy the Web app URL into config.js as APPS_SCRIPT_URL.
 *
 * Sheets created automatically on first use:
 *   BoardState  — one row per team, holds the whole board as JSON
 *   CommitLog   — one row per "Commit Update" click, holds a JSON snapshot
 */

const TEACHER_EMAIL = 'you@example.com'; // <-- CHANGE THIS

const STATE_SHEET = 'BoardState';
const LOG_SHEET = 'CommitLog';
const ROSTER_SHEET = 'TeamRoster';

function getSheet_(name, headerRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headerRow);
  }
  return sh;
}

function stateSheet_() {
  return getSheet_(STATE_SHEET, ['TeamId', 'StateJSON', 'UpdatedAt']);
}
function logSheet_() {
  return getSheet_(LOG_SHEET, ['Timestamp', 'TeamId', 'TeamName', 'SnapshotJSON']);
}

/**
 * TeamRoster tab — YOU fill this in, students never see or touch it.
 * Column B: comma-separated student emails for that team. Leave blank
 * for a team you don't want CC'd yet.
 */
function rosterSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ROSTER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ROSTER_SHEET);
    sh.appendRow(['TeamId', 'Student Emails (comma-separated)']);
    for (let i = 1; i <= 8; i++) sh.appendRow([String(i), '']);
    sh.setColumnWidth(2, 360);
  }
  return sh;
}

const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

function getTeamEmails_(teamId) {
  const sh = rosterSheet_();
  const data = sh.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(teamId)) {
      const raw = String(data[r][1] || '');
      return raw.split(',')
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return EMAIL_RE.test(s); });
    }
  }
  return [];
}

function getHistoryList_(teamId) {
  const sh = logSheet_();
  const data = sh.getDataRange().getValues();
  const out = [];
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][1]) === String(teamId)) {
      out.push({ id: r + 1, timestamp: data[r][0], sprintName: data[r][2] });
    }
  }
  out.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  return out;
}

function getHistorySnapshot_(teamId, id) {
  const sh = logSheet_();
  const row = parseInt(id, 10);
  if (!row || row < 2) return null;
  const rowVals = sh.getRange(row, 1, 1, 4).getValues()[0];
  if (String(rowVals[1]) !== String(teamId)) return null;
  try {
    return JSON.parse(rowVals[3]);
  } catch (e) {
    return null;
  }
}

function findTeamRow_(sheet, teamId) {
  const data = sheet.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(teamId)) return r + 1; // 1-indexed row
  }
  return -1;
}

function defaultState_(teamId) {
  return {
    sprintName: 'Team ' + teamId + ' — Sprint 1',
    sprintGoals: [], blockers: [], retroActions: [], congrats: [],
    lateCake: "Whoever's card sits in BLOCKED longest at Friday standup brings snacks next sprint.",
    outcomeLabel: 'Our Outcome', outcomeTarget: '', outcomeCurrent: '',
    designNotes: [], agenda: [], cards: []
  };
}

function getState_(teamId) {
  const sh = stateSheet_();
  const row = findTeamRow_(sh, teamId);
  if (row === -1) return defaultState_(teamId);
  try {
    return JSON.parse(sh.getRange(row, 2).getValue());
  } catch (e) {
    return defaultState_(teamId);
  }
}

function saveState_(teamId, state) {
  const sh = stateSheet_();
  let row = findTeamRow_(sh, teamId);
  const json = JSON.stringify(state);
  const now = new Date().toISOString();
  if (row === -1) {
    sh.appendRow([teamId, json, now]);
  } else {
    sh.getRange(row, 2, 1, 2).setValues([[json, now]]);
  }
}

function doGet(e) {
  const teamId = e.parameter.team;
  if (!teamId) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'missing team param' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (e.parameter.history === 'list') {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, commits: getHistoryList_(teamId) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (e.parameter.history === 'get') {
    const snap = getHistorySnapshot_(teamId, e.parameter.id);
    return ContentService.createTextOutput(JSON.stringify({ ok: !!snap, state: snap }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const state = getState_(teamId);
  return ContentService.createTextOutput(JSON.stringify({ ok: true, state: state }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'bad json' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const teamId = body.team;
  if (!teamId) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'missing team' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (body.action === 'save') {
    saveState_(teamId, body.state);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (body.action === 'commit') {
    saveState_(teamId, body.state);
    logSheet_().appendRow([
      new Date(), teamId, body.state.sprintName || ('Team ' + teamId), JSON.stringify(body.state)
    ]);
    sendCommitEmail_(teamId, body.state);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function listBlock_(title, items) {
  if (!items || !items.length) return '';
  const lis = items.map(function (i) { return '<li>' + esc_(i) + '</li>'; }).join('');
  return '<h3 style="margin:16px 0 4px;color:#1d6fb8;">' + esc_(title) + '</h3><ul style="margin:0;padding-left:20px;">' + lis + '</ul>';
}

function sendCommitEmail_(teamId, state) {
  const COLS = [
    ['pickme', 'Pick Me'], ['blocked', 'BLOCKED'], ['test', 'Test'], ['dev', 'Dev'],
    ['review', 'Review'], ['deploy', 'Deploy'], ['done', 'Done!']
  ];
  const cards = state.cards || [];

  let boardHtml = '<table style="width:100%;border-collapse:collapse;margin-top:8px;">';
  boardHtml += '<tr>' + COLS.map(function (c) {
    return '<th style="border:1px solid #d7dae0;background:#f4f5f7;padding:6px;font-size:12px;text-align:left;">' + c[1] + '</th>';
  }).join('') + '</tr><tr>';
  boardHtml += COLS.map(function (c) {
    const inCol = cards.filter(function (card) { return card.column === c[0]; });
    const items = inCol.map(function (card) {
      return '<div style="background:#f6d94c;border-radius:4px;padding:4px 6px;margin-bottom:4px;font-size:12px;">' + esc_(card.text) + '</div>';
    }).join('') || '<span style="color:#9aa0ab;font-size:11px;">—</span>';
    return '<td style="border:1px solid #d7dae0;padding:6px;vertical-align:top;">' + items + '</td>';
  }).join('');
  boardHtml += '</tr></table>';

  const retro = (state.retroActions || []).map(function (r) {
    return (r.done ? '✅ ' : '⬜ ') + r.text;
  });

  const html = ''
    + '<div style="font-family:Arial,sans-serif;color:#1f2430;max-width:820px;">'
    + '<h2 style="color:#1d6fb8;margin-bottom:0;">' + esc_(state.sprintName || ('Team ' + teamId)) + ' — Commit Update</h2>'
    + '<p style="color:#6b7280;margin-top:4px;">' + new Date().toLocaleString() + '</p>'
    + listBlock_('Sprint Goals', state.sprintGoals)
    + listBlock_('Blockers this Sprint', state.blockers)
    + listBlock_('Retro Actions', retro)
    + listBlock_('Congrats & Thanks', state.congrats)
    + listBlock_('Product Design Goodness', state.designNotes)
    + '<h3 style="margin:16px 0 4px;color:#1d6fb8;">Our Outcomes</h3>'
    + '<p>' + esc_(state.outcomeLabel) + ': ' + esc_(state.outcomeCurrent) + ' / ' + esc_(state.outcomeTarget) + '</p>'
    + '<h3 style="margin:16px 0 4px;color:#1d6fb8;">Board Snapshot</h3>'
    + boardHtml
    + '</div>';

  MailApp.sendEmail({
    to: TEACHER_EMAIL,
    cc: getTeamEmails_(teamId).join(','), // blank string is fine — MailApp just omits an empty cc
    subject: 'SDD Commit — ' + (state.sprintName || ('Team ' + teamId)),
    htmlBody: html
  });
}
