/**
 * CSI Sprint Board (Computer Science Innovations) — Google Apps Script backend
 * ---------------------------------------------------------------------------
 * SETUP
 *  1. Make a NEW Google Sheet (keep it separate from the CSP board's Sheet).
 *  2. Extensions > Apps Script. Delete the sample code, paste this whole file, Save.
 *  3. Change TEACHER_EMAIL below to your district address.
 *  4. Reload the Sheet. Use the new "CSI Sprint Board" menu:
 *       Set up tabs  (approve the permissions Google asks for)
 *       Set teacher passcode
 *  5. Paste your roster into the Roster tab. Row 1 headers:
 *       First | Last | Email | Project Team | Role | Intern
 *     Role is one of: PM, Asst PM, Developer, UX/UI Designer, Asset Artist,
 *     QA Tester, Marketing & Outreach. Intern is Y for interns, blank otherwise.
 *     Then run "Check roster" from the menu.
 *  6. Deploy > New deployment > Web app.  Execute as: Me.  Who has access: Anyone.
 *     Copy the /exec URL into API_URL at the top of the script in index.html.
 *
 * IMPORTANT: after ANY change to this file you must redeploy:
 *   Deploy > Manage deployments > pencil icon > Version: New version > Deploy
 * The /exec URL stays the same.
 */

const CONFIG = {
  // Where commit and finish emails are copied, and the email you type to open the teacher view.
  TEACHER_EMAIL: 'CHANGE_ME@lbschools.net',

  // Student emails: exactly 9 digits + @lbschools.net
  EMAIL_PATTERN: /^\d{9}@lbschools\.net$/,

  // Demo account for walking the class through the board. Emails go to the teacher only.
  DEMO_EMAIL: '000000000@lbschools.net',

  // Students type their first and last name with their email, and the board checks them
  // against the roster. Set to false if nicknames cause trouble.
  CHECK_NAMES: true,

  // Optional: your GitHub Pages board link, included in emails.
  BOARD_URL: ''
};

const TABS = {
  ROSTER: 'Roster', TEAMS: 'Teams', HISTORY: 'SprintHistory',
  LOG: 'CommitLog', STUDENTS: 'Students', ISSUES: 'RosterIssues'
};
const ROSTER_HEADERS = ['First', 'Last', 'Email', 'Project Team', 'Role', 'Intern'];
const CHUNKS = 6;            // a board is split across this many cells
const CHUNK = 45000;         // Sheets allows 50,000 characters per cell
const chunkHeads_ = p => { const h = []; for (let i = 1; i <= CHUNKS; i++) h.push(p + ' ' + i); return h; };
const TEAM_HEADERS = ['Team', 'Sprint', 'Sprint Name', 'Started', 'Version', 'Last Updated', 'Updated By'].concat(chunkHeads_('Board'));
const TEAM_DATA_COL = 8;     // first Board chunk column
const HISTORY_HEADERS = ['Finished', 'Team', 'Sprint', 'Sprint Name', 'Goals Met', 'Finished By'].concat(chunkHeads_('Snapshot'));
const HISTORY_DATA_COL = 7;
const LOG_HEADERS = ['Timestamp', 'Team', 'Sent By', 'Type', 'Recipients', 'Cards Done', 'Cards Total'];
const STUDENT_HEADERS = ['Email', 'First', 'Last', 'Team', 'Safe Sender Confirmed', 'First Seen', 'Last Seen'];
const ISSUE_HEADERS = ['Roster Row', 'Student', 'Project Team', 'Issue'];

const DEMO_TEAM = 'Demo Team';
const DEMO_MEMBERS = [
  { key: 'demo-me', first: 'Demo', last: 'Student', role: 'PM', intern: false },
  { key: 'demo-a', first: 'Sample', last: 'Developer', role: 'Developer', intern: false },
  { key: 'demo-b', first: 'Sample', last: 'Artist', role: 'Asset Artist', intern: false },
  { key: 'demo-c', first: 'Sample', last: 'Tester', role: 'QA Tester', intern: false },
  { key: 'demo-d', first: 'Sample', last: 'Intern', role: 'Marketing & Outreach', intern: true }
];

const ROLE_ALIASES = {
  'pm': 'PM', 'project manager': 'PM',
  'asst pm': 'Asst PM', 'assistant pm': 'Asst PM', 'asst. pm': 'Asst PM', 'apm': 'Asst PM',
  'assistant project manager': 'Asst PM', 'asst project manager': 'Asst PM',
  'developer': 'Developer', 'dev': 'Developer', 'programmer': 'Developer',
  'ux/ui designer': 'UX/UI Designer', 'ui/ux designer': 'UX/UI Designer', 'ux designer': 'UX/UI Designer',
  'ui designer': 'UX/UI Designer', 'ux/ui': 'UX/UI Designer', 'ui/ux': 'UX/UI Designer', 'designer': 'UX/UI Designer',
  'asset artist': 'Asset Artist', 'graphic artist': 'Asset Artist', 'artist': 'Asset Artist', 'asset creator': 'Asset Artist',
  'qa tester': 'QA Tester', 'qa': 'QA Tester', 'tester': 'QA Tester',
  'marketing & outreach': 'Marketing & Outreach', 'marketing and outreach': 'Marketing & Outreach',
  'marketing': 'Marketing & Outreach', 'outreach': 'Marketing & Outreach', 'pr': 'Marketing & Outreach',
  'public relations': 'Marketing & Outreach'
};

const PASSCODE_PROP = 'TEACHER_PASSCODE';
const DEMO_PROP = 'DEMO_SIGNIN_OPEN';   // 'yes' lets the demo address sign in from the main page
const MAX_PASSCODE_TRIES = 5;   // then locked for 10 minutes

/* ===== SHARED BOARD RULES: identical copy in index.html and Code.gs. Edit both together. ===== */
const CSI = (function () {
  const COLUMNS = ['pick', 'dev', 'test', 'review', 'deploy', 'done'];
  const COLUMN_NAMES = { pick: 'Pick Me', dev: 'Dev', test: 'Test', review: 'Review', deploy: 'Deploy', done: 'Done' };
  const ROLES = ['PM', 'Asst PM', 'Developer', 'UX/UI Designer', 'Asset Artist', 'QA Tester', 'Marketing & Outreach'];
  const LEAD_ROLES = ['PM', 'Asst PM'];
  const ASSET_TYPES = ['Image', 'Sound', 'Font', 'Data', 'Library/API', 'Mockup', 'Hardware', 'Other'];
  const RESULTS = { met: 'Met', partly: 'Partly met', missed: 'Missed' };
  const CRIT_STATUS = ['draft', 'submitted', 'returned', 'approved'];
  const PALETTE = ['#F7D84B', '#6FD0E0', '#F59AC2', '#8FD694', '#F9A95B', '#B9A2F0', '#A8C8F0', '#E8C39E', '#C6E377', '#F2A7A0'];
  const MAX = { goals: 3, internGoals: 1, sprintGoals: 60, cards: 120, criteria: 12, retro: 30, assets: 60, blockers: 40, congrats: 40, ops: 50 };
  const DEFAULT_CAKE = "Whoever's card stays flagged Blocked the longest at standup brings snacks next sprint.";

  const clone = x => JSON.parse(JSON.stringify(x));
  const fail = msg => { throw new Error(msg); };
  const T = (v, n) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, n);
  const short = t => (t.length > 40 ? t.slice(0, 38) + '…' : t);
  const isLead = m => !!m && LEAD_ROLES.indexOf(m.role) >= 0;
  const capOf = m => (m && m.intern ? MAX.internGoals : MAX.goals);
  const nameOf = m => (m ? (m.first + ' ' + m.last).trim() : 'A former teammate');

  function blank() {
    return {
      sprintNo: 1, sprint: 'Sprint 1', start: null,
      goals: [], cards: [], retro: [], assets: [], blockers: [], congrats: [],
      lateCake: DEFAULT_CAKE, prev: null,
      criteria: { status: 'draft', note: '', change: '', items: [] },
      updatedBy: '', updatedAt: null
    };
  }

  function sanitize(x) {
    x = x && typeof x === 'object' ? x : {};
    const s = (v, n) => String(v == null ? '' : v).slice(0, n);
    const arr = v => (Array.isArray(v) ? v : []);
    const id = v => s(v, 40);
    const hex = c => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c) : '#D9DEE4');
    const iso = v => (v && !isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null);
    const review = r => (r && typeof r === 'object' && r.by
      ? { by: id(r.by), name: s(r.name, 80), at: iso(r.at), override: !!r.override } : null);
    const card = c => ({
      id: id(c.id), text: s(c.text, 200), goalId: id(c.goalId), owner: id(c.owner),
      col: COLUMNS.indexOf(c.col) >= 0 ? c.col : 'pick', code: !!c.code,
      blocked: !!c.blocked, blockNote: s(c.blockNote, 160), review: review(c.review), seed: !!c.seed
    });
    const goal = g => ({ id: id(g.id), text: s(g.text, 160), owner: id(g.owner), color: hex(g.color), acId: id(g.acId) });
    const crit = x.criteria && typeof x.criteria === 'object' ? x.criteria : {};
    const p = x.prev && typeof x.prev === 'object' ? x.prev : null;
    const sprintNo = Math.max(1, Math.floor(Number(x.sprintNo) || 1));
    return {
      sprintNo: sprintNo,
      sprint: s(x.sprint, 60) || ('Sprint ' + sprintNo),
      start: iso(x.start),
      goals: arr(x.goals).slice(0, MAX.sprintGoals).map(goal),
      cards: arr(x.cards).slice(0, MAX.cards).map(card),
      retro: arr(x.retro).slice(0, MAX.retro).map(r => ({ id: id(r.id), text: s(r.text, 200), done: !!r.done, ref: id(r.ref) })),
      assets: arr(x.assets).slice(0, MAX.assets).map(a => ({
        id: id(a.id), type: ASSET_TYPES.indexOf(a.type) >= 0 ? a.type : 'Other',
        desc: s(a.desc, 200), source: s(a.source, 300), license: s(a.license, 120), by: id(a.by)
      })),
      blockers: arr(x.blockers).slice(0, MAX.blockers).map(k => ({
        id: id(k.id), text: s(k.text, 260), cardId: id(k.cardId), by: id(k.by), at: iso(k.at), cleared: !!k.cleared
      })),
      congrats: arr(x.congrats).slice(0, MAX.congrats).map(k => ({ id: id(k.id), text: s(k.text, 200), by: id(k.by) })),
      lateCake: x.lateCake == null ? DEFAULT_CAKE : s(x.lateCake, 300),
      prev: p ? {
        sprintNo: Math.max(0, Math.floor(Number(p.sprintNo) || 0)),
        sprint: s(p.sprint, 60),
        goals: arr(p.goals).slice(0, MAX.sprintGoals).map(g => {
          const o = goal(g);
          o.result = RESULTS[g.result] ? g.result : 'missed';
          o.carried = id(g.carried);
          return o;
        }),
        open: arr(p.open).slice(0, MAX.cards).map(card)
      } : null,
      criteria: {
        status: CRIT_STATUS.indexOf(crit.status) >= 0 ? crit.status : 'draft',
        note: s(crit.note, 400), change: s(crit.change, 400),
        items: arr(crit.items).slice(0, MAX.criteria).map(i => ({
          id: id(i.id), code: s(i.code, 8), text: s(i.text, 240),
          state: ['none', 'claimed', 'met'].indexOf(i.state) >= 0 ? i.state : 'none',
          sprints: arr(i.sprints).map(Number).filter(n => n > 0).slice(0, 50)
        }))
      },
      updatedBy: s(x.updatedBy, 80), updatedAt: iso(x.updatedAt)
    };
  }

  /* ---------- Helpers the rules and the screens both use ---------- */
  function memberOf(members, key) { return members.filter(m => m.key === key)[0] || null; }
  function goalsOwned(b, key, exceptId) { return b.goals.filter(g => g.owner === key && g.id !== exceptId).length; }

  function checkCap(b, m, exceptId) {
    if (goalsOwned(b, m.key, exceptId) >= capOf(m)) {
      fail(m.intern
        ? m.first + ' is an intern, so 1 Sprint Goal is the limit.'
        : m.first + ' already has 3 Sprint Goals this sprint. That is the limit.');
    }
  }
  function checkAc(b, acId) {
    const items = b.criteria.items;
    if (!items.length) return '';
    if (!acId) fail('Pick the acceptance criterion this goal moves forward.');
    if (!items.some(i => i.id === acId)) fail('That acceptance criterion was removed. Pick another one.');
    return acId;
  }
  function newCard(o) {
    return { id: o.id, text: o.text, goalId: o.goalId || '', owner: o.owner || '', col: o.col || 'pick',
      code: !!o.code, blocked: false, blockNote: '', review: null, seed: !!o.seed };
  }
  function findCard(b, id) { return b.cards.filter(c => c.id === id)[0] || fail('A teammate deleted that card.'); }
  function needLead(a, what) { if (!isLead(a)) fail('Only the PM or Asst PM can ' + what + '.'); }
  function critEditable(b) {
    if (b.criteria.status === 'submitted') fail('Your criteria are waiting for teacher approval. Pull them back to edit.');
    if (b.criteria.status === 'approved') fail('Your criteria are approved and locked. Use "Request a change" instead.');
  }
  function addBlockerFor(b, c, actor, now, id) {
    const text = c.text + (c.blockNote ? ': ' + c.blockNote : '');
    const open = b.blockers.filter(k => k.cardId === c.id && !k.cleared)[0];
    if (open) { open.text = text; return; }
    if (b.blockers.length >= MAX.blockers) b.blockers.shift();
    b.blockers.push({ id: id, text: text, cardId: c.id, by: actor ? actor.key : '', at: now, cleared: false });
  }

  /* ---------- One change to the board. Throws a student-friendly message when a rule says no. ---------- */
  function applyOp(b, op, ctx) {
    const a = ctx.actor;
    const now = ctx.now;
    const teacherOps = ['approveCriteria', 'returnCriteria', 'unlockCriteria', 'confirmCriterion'];
    if (teacherOps.indexOf(op.type) >= 0) { if (!ctx.teacher) fail('Only your teacher can do that.'); }
    else if (!a) fail('Only team members can change the board.');
    let result = {};

    switch (op.type) {
      case 'sprintName': {
        const t = T(op.text, 60);
        if (!t) fail('Give the sprint a name.');
        b.sprint = t;
        break;
      }

      case 'addGoal': {
        if (b.goals.some(g => g.id === op.id)) return result;
        const text = T(op.text, 160);
        if (!text) fail('Type the goal first.');
        const owner = memberOf(ctx.members, op.owner) || fail('Choose who owns this goal.');
        checkCap(b, owner);
        const acId = checkAc(b, op.acId);
        if (b.goals.length >= MAX.sprintGoals) fail('This sprint has the most goals the board can hold.');
        if (b.cards.length >= MAX.cards) fail('The board is full. Delete some cards or finish the sprint.');
        b.goals.push({ id: op.id, text: text, owner: owner.key, color: owner.color, acId: acId });
        b.cards.push(newCard({ id: op.cardId || op.id + 's', text: text, goalId: op.id, owner: owner.key, seed: true }));
        if (!b.start) b.start = now;
        break;
      }

      case 'editGoal': {
        const g = b.goals.filter(x => x.id === op.id)[0] || fail('A teammate removed that goal.');
        if (a.key !== g.owner && !isLead(a)) fail("Only the goal's owner or the PM can change it.");
        if (op.text != null) { const t = T(op.text, 160); if (!t) fail('A goal needs some text.'); g.text = t; }
        if (op.owner != null && op.owner !== g.owner) {
          const m = memberOf(ctx.members, op.owner) || fail('Choose a teammate from the list.');
          checkCap(b, m, g.id);
          g.owner = m.key; g.color = m.color;
        }
        if (op.acId != null) g.acId = checkAc(b, op.acId);
        break;
      }

      case 'removeGoal': {
        const g = b.goals.filter(x => x.id === op.id)[0];
        if (!g) return result;
        if (a.key !== g.owner && !isLead(a)) fail("Only the goal's owner or the PM can remove it.");
        b.goals = b.goals.filter(x => x.id !== g.id);
        b.cards = b.cards.filter(c => !(c.seed && c.goalId === g.id && c.col === 'pick'));
        b.cards.forEach(c => { if (c.goalId === g.id) c.goalId = ''; });
        break;
      }

      case 'addCard': {
        const c = op.card || {};
        if (b.cards.some(x => x.id === c.id)) return result;
        const text = T(c.text, 200);
        if (!text) fail('Type the card first.');
        if (!b.goals.some(g => g.id === c.goalId)) fail('Pick the Sprint Goal this card belongs to.');
        const owner = memberOf(ctx.members, c.owner) || a;
        if (b.cards.length >= MAX.cards) fail('The board is full. Delete some cards or finish the sprint.');
        b.cards.push(newCard({ id: c.id, text: text, goalId: c.goalId, owner: owner.key, code: !!c.code }));
        break;
      }

      case 'updateCard': {
        const c = findCard(b, op.id);
        if (op.text != null) { const t = T(op.text, 200); if (!t) fail('A card needs some text.'); c.text = t; }
        if (op.goalId != null) {
          if (op.goalId && !b.goals.some(g => g.id === op.goalId)) fail('A teammate removed that goal.');
          c.goalId = op.goalId;
        }
        if (op.owner != null) { const m = memberOf(ctx.members, op.owner) || fail('Choose a teammate from the list.'); c.owner = m.key; }
        if (op.code != null) c.code = !!op.code;
        break;
      }

      case 'deleteCard': {
        if (!b.cards.some(c => c.id === op.id)) return result;
        b.cards = b.cards.filter(c => c.id !== op.id);
        b.blockers.forEach(k => { if (k.cardId === op.id) k.cleared = true; });
        break;
      }

      case 'moveCard': {
        const c = findCard(b, op.id);
        if (COLUMNS.indexOf(op.col) < 0) fail('That column does not exist.');
        if (c.col === op.col) return result;
        if ((op.col === 'deploy' || op.col === 'done') && !c.review) {
          fail('"' + short(c.text) + '" needs a review before ' + COLUMN_NAMES[op.col] + '. A teammate checks it off in Review.');
        }
        if (['pick', 'dev', 'test'].indexOf(op.col) >= 0) c.review = null;
        b.cards = b.cards.filter(x => x.id !== c.id);
        c.col = op.col;
        b.cards.push(c);
        break;
      }

      case 'review': {
        const c = findCard(b, op.id);
        if (op.on) {
          if (c.review) return result;
          if (c.col !== 'review') fail('Move the card to Review first.');
          if (a.intern) fail("Interns don't sign off reviews. A full team member reviews this card.");
          if (a.key === c.owner) {
            if (!op.override) fail("You can't review your own card. Ask a teammate.");
            needLead(a, 'approve their own card');
          }
          c.review = { by: a.key, name: nameOf(a), at: now, override: a.key === c.owner };
        } else {
          if (!c.review) return result;
          if (c.col !== 'review') fail('Move the card back to Review to undo its review.');
          if (a.key !== c.review.by && !isLead(a)) fail('Only the reviewer or the PM can undo a review.');
          c.review = null;
        }
        break;
      }

      case 'block': {
        const c = findCard(b, op.id);
        if (op.on) {
          c.blocked = true;
          c.blockNote = T(op.note, 160);
          addBlockerFor(b, c, a, now, op.blockerId || ('k' + c.id + now));
        } else {
          c.blocked = false; c.blockNote = '';
          b.blockers.forEach(k => { if (k.cardId === c.id) k.cleared = true; });
        }
        break;
      }

      case 'addBlocker': {
        if (b.blockers.some(k => k.id === op.id)) return result;
        const t = T(op.text, 260);
        if (!t) fail('Describe what is blocking the team.');
        if (b.blockers.length >= MAX.blockers) b.blockers.shift();
        b.blockers.push({ id: op.id, text: t, cardId: '', by: a.key, at: now, cleared: false });
        break;
      }

      case 'clearBlocker': {
        const k = b.blockers.filter(x => x.id === op.id)[0];
        if (!k) return result;
        if (k.cardId) fail('Turn off the Blocked flag on the card instead.');
        k.cleared = !!op.cleared;
        break;
      }

      case 'removeBlocker': {
        const k = b.blockers.filter(x => x.id === op.id)[0];
        if (!k) return result;
        if (k.cardId) fail('Turn off the Blocked flag on the card instead.');
        b.blockers = b.blockers.filter(x => x.id !== op.id);
        break;
      }

      case 'lateCake':
        b.lateCake = T(op.text, 300);
        break;

      case 'addCongrats': {
        if (b.congrats.some(k => k.id === op.id)) return result;
        const t = T(op.text, 200);
        if (!t) fail('Type who you are thanking and why.');
        if (b.congrats.length >= MAX.congrats) fail('That is a lot of thanks. Remove a few older ones first.');
        b.congrats.push({ id: op.id, text: t, by: a.key });
        break;
      }

      case 'removeCongrats':
        b.congrats = b.congrats.filter(k => k.id !== op.id);
        break;

      case 'addRetro': {
        if (b.retro.some(r => r.id === op.id)) return result;
        const t = T(op.text, 200);
        if (!t) fail('Type the retro action first.');
        const ref = String(op.ref || '');
        if (ref && !(b.prev && b.prev.goals.some(g => g.id === ref))) fail('That goal is not from last sprint.');
        if (b.retro.length >= MAX.retro) fail('This sprint has the most retro actions the board can hold.');
        b.retro.push({ id: op.id, text: t, done: false, ref: ref });
        break;
      }

      case 'setRetro': {
        const r = b.retro.filter(x => x.id === op.id)[0] || fail('A teammate removed that retro action.');
        r.done = !!op.done;
        break;
      }

      case 'removeRetro':
        b.retro = b.retro.filter(r => r.id !== op.id);
        break;

      case 'addAsset': {
        const x = op.asset || {};
        if (b.assets.some(k => k.id === x.id)) return result;
        const desc = T(x.desc, 200);
        if (!desc) fail('Say what the asset is.');
        if (b.assets.length >= MAX.assets) fail('The asset list is full.');
        b.assets.push({
          id: x.id, type: ASSET_TYPES.indexOf(x.type) >= 0 ? x.type : 'Other', desc: desc,
          source: T(x.source, 300), license: T(x.license, 120), by: a.key
        });
        break;
      }

      case 'removeAsset':
        b.assets = b.assets.filter(k => k.id !== op.id);
        break;

      case 'carry': {
        const pg = (b.prev && b.prev.goals.filter(g => g.id === op.prevId)[0]) || fail('That goal is not from last sprint.');
        if (pg.carried) { if (pg.carried === op.id) return result; fail('That goal was already carried forward.'); }
        if (pg.result === 'met') fail('That goal was met. Only partly met or missed goals carry forward.');
        const owner = memberOf(ctx.members, pg.owner) || a;
        checkCap(b, owner);
        if (b.goals.length >= MAX.sprintGoals) fail('This sprint has the most goals the board can hold.');
        const acId = b.criteria.items.some(i => i.id === pg.acId) ? pg.acId : '';
        b.goals.push({ id: op.id, text: pg.text, owner: owner.key, color: owner.color, acId: acId });
        const moving = b.prev.open.filter(c => c.goalId === pg.id);
        b.prev.open = b.prev.open.filter(c => c.goalId !== pg.id);
        moving.forEach(c => {
          if (b.cards.length >= MAX.cards) return;
          c.goalId = op.id;
          b.cards.push(c);
          if (c.blocked) addBlockerFor(b, c, a, now, 'k' + c.id + b.sprintNo);
        });
        if (!moving.length) b.cards.push(newCard({ id: op.cardId || op.id + 's', text: pg.text, goalId: op.id, owner: owner.key, seed: true }));
        pg.carried = op.id;
        if (!b.start) b.start = now;
        break;
      }

      case 'addCriterion': {
        needLead(a, 'edit acceptance criteria');
        if (b.criteria.items.some(i => i.id === op.id)) return result;
        critEditable(b);
        const t = T(op.text, 240);
        if (!t) fail('Type the criterion first.');
        if (b.criteria.items.length >= MAX.criteria) fail('12 criteria is the limit.');
        const n = b.criteria.items.reduce((m, i) => Math.max(m, Number(String(i.code).replace(/\D/g, '')) || 0), 0) + 1;
        b.criteria.items.push({ id: op.id, code: 'AC-' + n, text: t, state: 'none', sprints: [] });
        break;
      }

      case 'editCriterion': {
        needLead(a, 'edit acceptance criteria');
        critEditable(b);
        const i = b.criteria.items.filter(x => x.id === op.id)[0] || fail('That criterion was removed.');
        const t = T(op.text, 240);
        if (!t) fail('A criterion needs some text.');
        i.text = t;
        break;
      }

      case 'removeCriterion': {
        needLead(a, 'edit acceptance criteria');
        if (!b.criteria.items.some(i => i.id === op.id)) return result;
        critEditable(b);
        b.criteria.items = b.criteria.items.filter(i => i.id !== op.id);
        b.goals.forEach(g => { if (g.acId === op.id) g.acId = ''; });
        break;
      }

      case 'submitCriteria': {
        needLead(a, 'send criteria for approval');
        if (b.criteria.status === 'submitted') return result;
        critEditable(b);
        if (!b.criteria.items.length) fail('Add at least one acceptance criterion first.');
        b.criteria.status = 'submitted';
        break;
      }

      case 'withdrawCriteria':
        needLead(a, 'pull criteria back');
        if (b.criteria.status !== 'submitted') return result;
        b.criteria.status = 'draft';
        break;

      case 'requestChange': {
        needLead(a, 'request a change');
        if (b.criteria.status !== 'approved') fail('You can edit your criteria directly until they are approved.');
        const t = T(op.text, 400);
        if (!t) fail('Say what you want to change and why.');
        b.criteria.change = t;
        break;
      }

      case 'approveCriteria':
        if (!b.criteria.items.length) fail('There are no criteria to approve.');
        b.criteria.status = 'approved'; b.criteria.note = ''; b.criteria.change = '';
        break;

      case 'returnCriteria': {
        const t = T(op.note, 400);
        if (!t) fail('Add a note so the PM knows what to fix.');
        b.criteria.status = 'returned'; b.criteria.note = t; b.criteria.change = '';
        break;
      }

      case 'unlockCriteria':
        b.criteria.status = 'returned';
        b.criteria.note = 'Unlocked for your change: ' + (b.criteria.change || 'make your edits, then send them again.');
        b.criteria.change = '';
        break;

      case 'confirmCriterion': {
        const i = b.criteria.items.filter(x => x.id === op.id)[0] || fail('That criterion was removed.');
        i.state = op.on ? 'met' : 'none';
        break;
      }

      case 'finish': {
        needLead(a, 'finish the sprint');
        if (Number(op.sprintNo) !== b.sprintNo) return result;
        if (!b.goals.length) fail('Add at least one Sprint Goal before finishing.');
        const res = op.results || {};
        if (b.goals.some(g => !RESULTS[res[g.id]])) fail('Mark every goal Met, Partly met, or Missed.');
        b.goals.forEach(g => {
          const i = b.criteria.items.filter(x => x.id === g.acId)[0];
          if (i && i.sprints.indexOf(b.sprintNo) < 0) i.sprints.push(b.sprintNo);
        });
        (Array.isArray(op.claims) ? op.claims : []).forEach(id => {
          const i = b.criteria.items.filter(x => x.id === id)[0];
          if (i && i.state === 'none') i.state = 'claimed';
        });
        const snap = clone(b);
        snap.goals.forEach(g => { g.result = res[g.id]; });
        snap.finishedAt = now;
        snap.finishedBy = nameOf(a);
        result = { snapshot: snap };
        const n = b.sprintNo + 1;
        b.prev = {
          sprintNo: b.sprintNo, sprint: b.sprint,
          goals: snap.goals.map(g => ({ id: g.id, text: g.text, owner: g.owner, color: g.color, acId: g.acId, result: g.result, carried: '' })),
          open: b.cards.filter(c => c.col !== 'done')
        };
        b.sprintNo = n; b.sprint = 'Sprint ' + n; b.start = null;
        b.goals = []; b.cards = []; b.retro = []; b.blockers = []; b.congrats = [];
        break;
      }

      default:
        fail('The board does not know how to do that yet. Reload the page.');
    }

    b.updatedBy = a ? nameOf(a) : 'Teacher';
    b.updatedAt = now;
    return result;
  }

  /* Run a batch of changes. Each change is all-or-nothing; a rejected one is skipped and reported. */
  function run(board, ops, ctx) {
    let b = board;
    const rejected = [], finished = [];
    let applied = 0;
    (Array.isArray(ops) ? ops : []).slice(0, MAX.ops).forEach(op => {
      const trial = clone(b);
      try {
        const r = applyOp(trial, op || {}, ctx);
        b = trial; applied++;
        if (r && r.snapshot) finished.push(r.snapshot);
      } catch (e) {
        rejected.push({ opId: op && op.opId, error: String((e && e.message) || e) });
      }
    });
    return { board: b, applied: applied, rejected: rejected, finished: finished };
  }

  /* ---------- Numbers for the screens, emails, and teacher view ---------- */
  function teamStats(b) {
    return {
      goals: b.goals.length,
      done: b.cards.filter(c => c.col === 'done').length,
      total: b.cards.length,
      blocked: b.cards.filter(c => c.blocked).length,
      retroDone: b.retro.filter(r => r.done).length,
      retroTotal: b.retro.length
    };
  }

  function memberStats(b, key) {
    const mine = b.cards.filter(c => c.owner === key);
    return {
      goals: goalsOwned(b, key),
      owned: mine.length,
      done: mine.filter(c => c.col === 'done').length,
      code: mine.filter(c => c.code).length,
      codeDone: mine.filter(c => c.code && c.col === 'done').length,
      reviews: b.cards.filter(c => c.review && c.review.by === key && !c.review.override).length,
      shipped: mine.some(c => c.col === 'done')
    };
  }

  function critState(b, item) {
    if (item.state === 'met') return 'met';
    if (item.state === 'claimed') return 'claimed';
    if (item.sprints.length || b.goals.some(g => g.acId === item.id)) return 'progress';
    return 'none';
  }

  function finishWarnings(b, members) {
    const w = [];
    const open = b.cards.filter(c => c.col !== 'done').length;
    if (open) w.push(open + ' card' + (open === 1 ? " isn't" : "s aren't") + ' Done. They wait under "From Sprint ' + b.sprintNo + '" and come back if you carry their goal forward.');
    const quiet = members.filter(m => !m.intern && !b.cards.some(c => c.owner === m.key && c.col === 'done'));
    if (quiet.length) w.push('No finished card this sprint: ' + quiet.map(m => m.first + ' ' + m.last).join(', ') + '.');
    const blocked = b.cards.filter(c => c.blocked).length;
    if (blocked) w.push(blocked + ' card' + (blocked === 1 ? ' is' : 's are') + ' still flagged Blocked.');
    if (b.criteria.items.length) {
      const unlinked = b.goals.filter(g => !g.acId).length;
      if (unlinked) w.push(unlinked + ' goal' + (unlinked === 1 ? " isn't" : "s aren't") + ' linked to an acceptance criterion.');
    }
    return w;
  }


  // Calendar days from start to now, counting both days.
  function days(startIso, now) {
    if (!startIso) return null;
    const a = new Date(startIso), b = now ? new Date(now) : new Date();
    const d0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const d1 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((d1 - d0) / 86400000) + 1;
  }

  // One row of the teacher's Teams table.
  function teamSummary(team, members, b, opened, finishedCount, updatedIso) {
    const st = teamStats(b);
    const lead = r => members.filter(m => m.role === r).map(m => m.first + ' ' + m.last).join(', ');
    const items = b.criteria.items;
    const count = s => items.filter(i => critState(b, i) === s).length;
    return {
      team: team, pm: lead('PM'), asst: lead('Asst PM'), size: members.length,
      interns: members.filter(m => m.intern).length,
      sprintNo: b.sprintNo, sprint: b.sprint,
      status: b.start ? 'In progress' : (opened ? 'Between sprints' : 'Not opened'),
      start: b.start, days: days(b.start),
      goals: st.goals, cardsDone: st.done, cardsTotal: st.total, blocked: st.blocked,
      retroDone: st.retroDone, retroTotal: st.retroTotal,
      crit: { status: b.criteria.status, change: !!b.criteria.change, total: items.length,
        met: count('met'), claimed: count('claimed'), progress: count('progress') },
      finished: finishedCount, lastUpdated: updatedIso || null, updatedBy: b.updatedBy || ''
    };
  }

  // One row of the teacher's Students table. codeEarlier = Code cards finished in past sprints.
  function studentRow(p, b, codeEarlier, seen) {
    const st = memberStats(b, p.key);
    seen = seen || {};
    return {
      email: p.email, first: p.first, last: p.last, team: p.team, role: p.role || '', intern: !!p.intern,
      safe: seen.safe || null, lastSeen: seen.lastSeen || null,
      goals: st.goals, cap: capOf(p), owned: st.owned, done: st.done,
      codeDone: st.codeDone, codeAll: st.codeDone + (codeEarlier || 0), reviews: st.reviews, shipped: st.shipped
    };
  }

  // Teammates sorted by last name; each gets their own sticky-note color.
  function withColors(list) {
    return list.slice()
      .sort((a, b) => (a.last + ' ' + a.first).localeCompare(b.last + ' ' + b.first))
      .map((m, i) => Object.assign({}, m, { color: PALETTE[i % PALETTE.length] }));
  }

  // Code cards each student finished in a finished-sprint snapshot.
  function codeByOwner(snap) {
    const out = {};
    (snap.cards || []).forEach(c => { if (c.code && c.col === 'done') out[c.owner] = (out[c.owner] || 0) + 1; });
    return out;
  }

  return {
    COLUMNS, COLUMN_NAMES, ROLES, LEAD_ROLES, ASSET_TYPES, RESULTS, PALETTE, MAX, DEFAULT_CAKE,
    blank, sanitize, applyOp, run, clone, teamStats, memberStats, critState, finishWarnings,
    isLead, capOf, nameOf, memberOf, goalsOwned, days, teamSummary, studentRow, withColors, codeByOwner
  };
})();
/* ===== END SHARED BOARD RULES ===== */


/* ================================================================
 *  Web app endpoints
 * ================================================================ */

function doGet() {
  return json_({ ok: true, message: 'CSI Sprint Board API is running.' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (String(req.action || '').indexOf('teacher') === 0) return json_(teacher_(normEmail_(req.email), req));

    const w = who_(req);
    switch (req.action) {
      case 'signin': return json_(signin_(w));
      case 'poll': return json_(poll_(w, req));
      case 'ops': return json_(withLock_(() => ops_(w, req.ops)));
      case 'commit': return json_(commit_(w));
      case 'safe': return json_(withLock_(() => { touchStudent_(w, { safe: true }); return { ok: true }; }));
      case 'history': return json_({ ok: true, snapshot: historySnapshot_(w.team, req.sprintNo) });
      default: return json_({ ok: false, error: 'Unknown action.' });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

// Who is asking, which team they're on, and their teammates. Throws a friendly message if they can't get in.
function who_(req) {
  const email = normEmail_(req.email);
  if (!CONFIG.EMAIL_PATTERN.test(email)) {
    throw new Error('Use your school email: your 9-digit student ID followed by @lbschools.net.');
  }
  if (email === normEmail_(CONFIG.DEMO_EMAIL)) {
    // From the teacher view (passcode sent along) the demo always opens. From the main page it opens
    // only while "Allow demo sign-in" is checked; otherwise it looks like any address not on the roster.
    if (!demoOpen_() && teacherCheck_(normEmail_(req.tEmail), req.tCode)) {
      throw new Error("That email isn't on the CSI roster. Double-check your 9 digits, then ask your teacher to add you.");
    }
    const members = withColors_(DEMO_MEMBERS.map(m => Object.assign({ email: '' }, m)));
    return { demo: true, email: email, team: DEMO_TEAM, me: members.filter(m => m.key === 'demo-me')[0], members: members };
  }
  const roster = readRoster_(false);
  if (roster.headerError || !roster.people.length) {
    throw new Error("The CSI roster isn't loaded yet. Let your teacher know.");
  }
  const p = roster.people.filter(x => x.email === email)[0];
  if (!p) throw new Error("That email isn't on the CSI roster. Double-check your 9 digits, then ask your teacher to add you.");
  if (CONFIG.CHECK_NAMES && !namesMatch_(p, req.first, req.last)) {
    throw new Error("That name doesn't match the roster for this student ID. Use the first and last name your teacher has on file.");
  }
  if (!p.team) throw new Error("You aren't on a Project Team yet. Ask your teacher to add your team to the roster.");
  const members = teamMembers_(roster.people, p.team);
  return { demo: false, email: email, team: p.team, me: members.filter(m => m.key === p.key)[0], members: members };
}

function signin_(w) {
  const safe = withLock_(() => touchStudent_(w, {}));
  const cur = readBoard_(w.team);
  return {
    ok: true,
    demo: w.demo,
    team: w.team,
    me: publicMember_(w.me),
    members: w.members.map(publicMember_),
    board: cur.board,
    version: cur.version,
    history: historyList_(w.team),
    safe: safe,
    sender: senderEmail_()
  };
}

function poll_(w, req) {
  const v = cachedVersion_(w.team);
  if (v != null && v === Number(req.version)) return { ok: true, same: true };
  const cur = readBoard_(w.team);
  if (cur.version === Number(req.version)) return { ok: true, same: true };
  return { ok: true, board: cur.board, version: cur.version };
}

function ops_(w, ops) {
  const cur = readBoard_(w.team);
  const ctx = { members: w.members, actor: w.me, teacher: false, now: new Date().toISOString() };
  const r = CSI.run(cur.board, ops, ctx);
  let version = cur.version;
  if (r.applied) {
    version = cur.version + 1;
    writeBoard_(w.team, r.board, version);
  }
  const out = { ok: true, board: r.board, version: version, rejected: r.rejected };
  if (r.finished.length) {
    out.finished = [];
    r.finished.forEach(snap => {
      appendHistory_(w.team, snap);
      out.finished.push(snap.sprintNo);
      try { sendBoardEmail_(w, snap, 'Finish'); }
      catch (e) { out.warning = 'Sprint finished and saved, but the email did not send: ' + e.message; }
    });
    out.history = historyList_(w.team);
  }
  return out;
}

function commit_(w) {
  const cur = readBoard_(w.team);
  sendBoardEmail_(w, cur.board, 'Commit');
  return { ok: true, sent: true, to: w.demo ? 'teacher' : 'team' };
}

/* ================================================================
 *  Teacher view
 * ================================================================ */

// Returns an error message, or '' when the email and passcode are the teacher's.
function teacherCheck_(email, code) {
  if (/CHANGE_ME/i.test(CONFIG.TEACHER_EMAIL)) return "The teacher view isn't set up yet. Set TEACHER_EMAIL in Code.gs, then redeploy.";
  if (email !== normEmail_(CONFIG.TEACHER_EMAIL)) return "That email isn't set up as the teacher account for this board.";
  const saved = PropertiesService.getScriptProperties().getProperty(PASSCODE_PROP);
  if (!saved) return 'No teacher passcode yet. In the Sheet, choose CSI Sprint Board > Set teacher passcode.';
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('teacherFails') || 0);
  if (fails >= MAX_PASSCODE_TRIES) return 'Too many wrong passcodes. Wait 10 minutes, then try again.';
  if (String(code || '') !== saved) { cache.put('teacherFails', String(fails + 1), 600); return 'That passcode is wrong.'; }
  cache.remove('teacherFails');
  return '';
}

function demoOpen_() { return PropertiesService.getScriptProperties().getProperty(DEMO_PROP) === 'yes'; }

function teacher_(email, req) {
  const bad = teacherCheck_(email, req.code);
  if (bad) return { ok: false, error: bad };

  switch (req.action) {
    case 'teacherList': return teacherList_();
    case 'teacherBoard': return teacherBoard_(String(req.team || ''));
    case 'teacherOps': return withLock_(() => teacherOps_(String(req.team || ''), req.ops));
    case 'teacherSetRole': return withLock_(() => setRole_(normEmail_(req.student), req.role, req.intern));
    case 'teacherEmailLeads': return emailLeads_(String(req.team || ''), req.subject, req.message, !!req.copyMe);
    case 'teacherHistory': return { ok: true, snapshot: historySnapshot_(String(req.team || ''), req.sprintNo) };
    case 'teacherDemoSignin':
      PropertiesService.getScriptProperties().setProperty(DEMO_PROP, req.on ? 'yes' : 'no');
      return { ok: true, demoOpen: demoOpen_() };
    case 'teacherResetDemo': return withLock_(() => { deleteTeam_(DEMO_TEAM); return { ok: true }; });
    default: return { ok: false, error: 'Unknown action.' };
  }
}

function teacherList_() {
  const roster = readRoster_(true);
  const boards = allBoards_();
  const hist = allHistory_();
  const seen = studentsByEmail_();

  const teamNames = {};
  roster.people.forEach(p => { if (p.team) teamNames[p.team] = true; });
  const teams = Object.keys(teamNames).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(t => {
    const members = teamMembers_(roster.people, t);
    return teamSummary_(t, members, boards[t], hist[t] || []);
  });

  const students = roster.people.map(p => {
    const rec = boards[p.team];
    let earlier = 0;
    (hist[p.team] || []).forEach(h => { earlier += h.codeDone[p.key] || 0; });
    return CSI.studentRow(p, rec ? rec.board : CSI.blank(), earlier, seen[p.email]);
  });

  const demoRec = boards[DEMO_TEAM];
  let quota = null;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = null; }
  return {
    ok: true,
    teams: teams,
    students: students,
    issues: roster.headerError ? [{ row: 1, who: '', team: '', issue: roster.headerError }] : roster.issues,
    roles: CSI.ROLES,
    quota: quota,
    sender: senderEmail_(),
    demo: demoRec ? teamSummary_(DEMO_TEAM, withColors_(DEMO_MEMBERS.slice()), demoRec, hist[DEMO_TEAM] || []) : null,
    demoEmail: normEmail_(CONFIG.DEMO_EMAIL),
    demoOpen: demoOpen_()
  };
}

function teamSummary_(team, members, rec, hist) {
  return CSI.teamSummary(team, members, rec ? rec.board : CSI.blank(), !!rec, hist.length,
    rec && rec.updated ? rec.updated.toISOString() : null);
}

function teacherBoard_(team) {
  const members = team === DEMO_TEAM ? withColors_(DEMO_MEMBERS.slice()) : teamMembers_(readRoster_(true).people, team);
  if (!members.length) throw new Error('Nobody on the roster is on that team.');
  const cur = readBoard_(team);
  return { ok: true, team: team, members: members.map(publicMember_), board: cur.board, version: cur.version, history: historyList_(team) };
}

function teacherOps_(team, ops) {
  const members = team === DEMO_TEAM ? withColors_(DEMO_MEMBERS.slice()) : teamMembers_(readRoster_(true).people, team);
  if (!members.length) throw new Error('Nobody on the roster is on that team.');
  const cur = readBoard_(team);
  const r = CSI.run(cur.board, ops, { members: members, actor: null, teacher: true, now: new Date().toISOString() });
  let version = cur.version;
  if (r.applied) { version++; writeBoard_(team, r.board, version); }
  return { ok: true, board: r.board, version: version, rejected: r.rejected };
}

function setRole_(email, role, intern) {
  role = String(role == null ? '' : role);
  if (role && CSI.ROLES.indexOf(role) < 0) throw new Error('Pick a role from the list.');
  const sh = SpreadsheetApp.getActive().getSheetByName(TABS.ROSTER);
  if (!sh) throw new Error('There is no Roster tab yet.');
  const vals = sh.getDataRange().getValues();
  const idx = headerIndex_(vals[0]);
  if (idx.missing.length) throw new Error('The Roster tab is missing: ' + idx.missing.join(', ') + '.');
  let row = -1, team = '';
  for (let i = 1; i < vals.length; i++) {
    if (normEmail_(vals[i][idx.email]) === email) { row = i; team = String(vals[i][idx.team]).trim(); break; }
  }
  if (row < 0) throw new Error("That student isn't on the Roster tab anymore.");
  if (role === 'PM' || role === 'Asst PM') {
    for (let i = 1; i < vals.length; i++) {
      if (i !== row && String(vals[i][idx.team]).trim() === team && normRole_(vals[i][idx.role]) === role) {
        throw new Error(team + ' already has a ' + role + ': ' + vals[i][idx.first] + ' ' + vals[i][idx.last] + '. Change that student first.');
      }
    }
  }
  sh.getRange(row + 1, idx.role + 1).setValue(role);
  if (intern != null) sh.getRange(row + 1, idx.intern + 1).setValue(intern ? 'Y' : '');
  CacheService.getScriptCache().remove('roster');
  return { ok: true };
}

function emailLeads_(team, subject, message, copyMe) {
  const leads = teamMembers_(readRoster_(true).people, team).filter(m => CSI.isLead(m));
  if (!leads.length) throw new Error(team + ' has no PM or Asst PM on the roster yet.');
  const subj = clean_(subject, 120);
  const msg = String(message == null ? '' : message).trim().slice(0, 5000);
  if (!subj || !msg) throw new Error('Add a subject and a message.');
  const html = '<div style="font-family:Arial,sans-serif;color:#1F2A37;max-width:640px">' +
    esc_(msg).replace(/\n/g, '<br>') +
    '<p style="color:#5B6776;margin-top:18px">Sent to the ' + esc_(team) + ' PM and Asst PM from the CSI Sprint Board.</p></div>';
  const mail = { to: leads.map(m => m.email).join(','), subject: '[CSI] ' + team + ': ' + subj, htmlBody: html, replyTo: CONFIG.TEACHER_EMAIL };
  if (copyMe) mail.cc = CONFIG.TEACHER_EMAIL;
  MailApp.sendEmail(mail);
  sheet_(TABS.LOG, LOG_HEADERS).appendRow([new Date(), team, 'Teacher', 'Email to PM + Asst', leads.length + (copyMe ? 1 : 0), '', '']);
  return { ok: true, sentTo: leads.map(m => m.first + ' ' + m.last) };
}

/* ================================================================
 *  Emails
 * ================================================================ */

function sendBoardEmail_(w, b, type) {
  if (/CHANGE_ME/i.test(CONFIG.TEACHER_EMAIL)) {
    throw new Error("Your board saved, but the teacher email isn't set up yet, so no update was sent. Let your teacher know.");
  }
  const sender = w.me ? w.me.first + ' ' + w.me.last : 'Someone';
  const label = w.team + ', ' + b.sprint;
  const mail = {
    subject: w.demo
      ? '[CSI Sprint] DEMO ' + (type === 'Finish' ? 'finished' : 'update')
      : (type === 'Finish' ? '[CSI Sprint] FINISHED: ' : '[CSI Sprint] Update: ') + label + ' (from ' + sender + ')',
    htmlBody: boardHtml_(w.team, b, w.members, type, sender)
  };
  let count;
  if (w.demo) {
    mail.to = CONFIG.TEACHER_EMAIL;
    count = 1;
  } else {
    const to = w.members.map(m => m.email).filter(Boolean);
    mail.to = to.join(',');
    mail.cc = CONFIG.TEACHER_EMAIL;
    mail.replyTo = w.email;
    count = to.length + 1;
  }
  MailApp.sendEmail(mail);
  if (w.demo) return;
  const st = CSI.teamStats(b);
  sheet_(TABS.LOG, LOG_HEADERS).appendRow([new Date(), w.team, sender, type, count, st.done, st.total]);
}

function boardHtml_(team, b, members, type, sender) {
  const e = esc_;
  const fmt = x => (x ? Utilities.formatDate(new Date(x), Session.getScriptTimeZone(), 'MMM d, yyyy') : '—');
  const who = key => { const m = CSI.memberOf(members, key); return m ? m.first + ' ' + m.last : 'Former teammate'; };
  const colorOf = key => { const m = CSI.memberOf(members, key); return m ? m.color : '#D9DEE4'; };
  const acOf = id => b.criteria.items.filter(i => i.id === id)[0];
  const h3 = t => '<h3 style="margin:18px 0 6px;font-size:15px">' + t + '</h3>';
  const sw = c => '<span style="display:inline-block;width:12px;height:12px;background:' + c + ';border-radius:2px;margin-right:6px"></span>';
  const st = CSI.teamStats(b);

  let h = '<div style="font-family:Arial,sans-serif;color:#1F2A37;max-width:780px">';
  h += '<h2 style="margin:0 0 4px">' + e(team) + ': ' + e(b.sprint) + (type === 'Finish' ? ' (finished)' : '') + '</h2>';
  h += '<p style="margin:0 0 10px;color:#5B6776">Sent by ' + e(sender) + '. Started ' + fmt(b.start) +
    (type === 'Finish' ? ', finished ' + fmt(b.finishedAt) : '') + '. ' + st.done + ' of ' + st.total + ' cards done.</p>';

  if (b.criteria.items.length) {
    h += h3('Acceptance criteria');
    h += '<p style="margin:0">' + b.criteria.items.map(i => {
      const s = CSI.critState(b, i);
      const bg = { met: '#1E7B45', claimed: '#B7791F', progress: '#2457C5', none: '#9AA6B5' }[s];
      return '<span title="' + e(i.text) + '" style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:10px;color:#fff;background:' + bg + '">' + e(i.code) + '</span>';
    }).join('') + '</p>';
  }

  h += h3('Sprint Goals');
  h += b.goals.length ? '<ul style="margin:0;padding-left:18px">' + b.goals.map(g => {
    const cs = b.cards.filter(c => c.goalId === g.id), dn = cs.filter(c => c.col === 'done').length;
    const ac = acOf(g.acId);
    return '<li>' + sw(colorOf(g.owner)) + e(g.text) + ' <span style="color:#5B6776">(' + e(who(g.owner)) +
      (ac ? ', ' + e(ac.code) : '') + ', ' + dn + ' of ' + cs.length + ' done' +
      (g.result ? ', <b>' + CSI.RESULTS[g.result] + '</b>' : '') + ')</span></li>';
  }).join('') + '</ul>' : '<p style="color:#5B6776">No goals yet.</p>';

  h += h3('Board');
  h += '<table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px">';
  CSI.COLUMNS.forEach(col => {
    const cs = b.cards.filter(c => c.col === col);
    h += '<tr><td style="vertical-align:top;border-top:1px solid #C9D1DA;width:90px"><b>' + CSI.COLUMN_NAMES[col] + '</b> (' + cs.length + ')</td><td style="border-top:1px solid #C9D1DA">';
    h += cs.map(c => {
      const tags = [];
      if (c.code) tags.push('Code');
      if (c.blocked) tags.push('<span style="color:#B42318">BLOCKED</span>');
      if (c.review) tags.push('reviewed by ' + e(c.review.name));
      return '<span style="display:inline-block;margin:2px 4px 2px 0;padding:3px 6px;background:' + colorOf(c.owner) + ';border-radius:3px">' +
        e(c.text) + ' <i>(' + e(who(c.owner)) + (tags.length ? ', ' + tags.join(', ') : '') + ')</i></span>';
    }).join('') || '<span style="color:#5B6776">—</span>';
    h += '</td></tr>';
  });
  h += '</table>';

  const open = b.blockers.filter(k => !k.cleared);
  if (b.blockers.length) {
    h += h3('Blockers this Sprint (' + open.length + ' open)');
    h += '<ul style="margin:0;padding-left:18px">' + b.blockers.map(k => '<li>' + (k.cleared ? '<s>' + e(k.text) + '</s>' : '<b>' + e(k.text) + '</b>') + '</li>').join('') + '</ul>';
  }
  if (b.retro.length) {
    const prevGoal = id => (b.prev ? b.prev.goals.filter(g => g.id === id)[0] : null);
    h += h3('Retro Actions (' + st.retroDone + ' of ' + st.retroTotal + ' done)');
    h += '<ul style="margin:0;padding-left:18px">' + b.retro.map(r => {
      const g = prevGoal(r.ref);
      return '<li>' + (r.done ? '<s>' + e(r.text) + '</s>' : e(r.text)) +
        (g ? ' <span style="color:#5B6776">(about: ' + e(g.text) + ', ' + CSI.RESULTS[g.result] + ')</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  if (b.congrats.length) {
    h += h3('Congrats &amp; Thanks');
    h += '<ul style="margin:0;padding-left:18px">' + b.congrats.map(k => '<li>' + e(k.text) + ' <span style="color:#5B6776">(' + e(who(k.by)) + ')</span></li>').join('') + '</ul>';
  }
  if (b.assets.length) {
    h += h3('Assets &amp; Sources');
    h += '<ul style="margin:0;padding-left:18px">' + b.assets.map(a => '<li><b>' + e(a.type) + ':</b> ' + e(a.desc) + ', <i>' +
      e(a.source || 'no source listed') + '</i>' + (a.license ? ' (' + e(a.license) + ')' : '') + '</li>').join('') + '</ul>';
  }
  if (b.lateCake) h += h3('Late Cake') + '<p style="margin:0">' + e(b.lateCake) + '</p>';
  if (CONFIG.BOARD_URL) h += '<p style="margin-top:18px"><a href="' + e(CONFIG.BOARD_URL) + '">Open the sprint board</a></p>';
  h += '</div>';
  return h;
}

/* ================================================================
 *  Teacher menu (in the Sheet)
 * ================================================================ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('CSI Sprint Board')
    .addItem('Set up tabs', 'setupSheets')
    .addItem('Set teacher passcode', 'setTeacherPasscode')
    .addSeparator()
    .addItem('Check roster', 'checkRoster')
    .addSeparator()
    .addItem('Reset demo board', 'resetDemoBoard')
    .addToUi();
}

function setupSheets() {
  sheet_(TABS.ROSTER, ROSTER_HEADERS);
  sheet_(TABS.TEAMS, TEAM_HEADERS).getRange('D:D').setNumberFormat('yyyy-mm-dd');
  sheet_(TABS.HISTORY, HISTORY_HEADERS).getRange('A:A').setNumberFormat('yyyy-mm-dd h:mm');
  sheet_(TABS.LOG, LOG_HEADERS);
  sheet_(TABS.STUDENTS, STUDENT_HEADERS).getRange('E:G').setNumberFormat('yyyy-mm-dd h:mm');
  SpreadsheetApp.getUi().alert(
    'Tabs are ready.\n\nNext: paste your roster into the Roster tab with these headers in row 1:\n' +
    ROSTER_HEADERS.join(' | ') + '\n\nThen run CSI Sprint Board > Check roster, and Set teacher passcode.');
}

function setTeacherPasscode() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Set teacher passcode',
    'Choose a passcode for the teacher view, at least 6 characters. You type it on the board after your email (' + CONFIG.TEACHER_EMAIL + ').',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const v = r.getResponseText().trim();
  if (v.length < 6) { ui.alert('Use at least 6 characters. The passcode was not changed.'); return; }
  PropertiesService.getScriptProperties().setProperty(PASSCODE_PROP, v);
  CacheService.getScriptCache().remove('teacherFails');
  ui.alert('Passcode saved. On the board, type ' + CONFIG.TEACHER_EMAIL + ', then this passcode.');
}

function checkRoster() {
  const r = readRoster_(true);
  const rows = r.headerError ? [[1, '', '', r.headerError]] : r.issues.map(i => [i.row || '', i.who, i.team, i.issue]);
  const sh = resetSheet_(TABS.ISSUES, ISSUE_HEADERS);
  if (rows.length) sh.getRange(2, 1, rows.length, ISSUE_HEADERS.length).setValues(rows);
  const teams = {};
  r.people.forEach(p => { if (p.team) teams[p.team] = true; });
  SpreadsheetApp.getUi().alert(rows.length
    ? rows.length + ' roster issue(s). See the ' + TABS.ISSUES + ' tab. Students can still sign in while you fix these.'
    : 'Roster looks good: ' + r.people.length + ' students on ' + Object.keys(teams).length + ' teams.');
}

function resetDemoBoard() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Reset demo board', 'Delete everything on the demo board (' + CONFIG.DEMO_EMAIL + ')?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const removed = withLock_(() => deleteTeam_(DEMO_TEAM));
  ui.alert(removed ? 'Demo board cleared.' : 'The demo board was already empty.');
}

/* ================================================================
 *  Roster
 * ================================================================ */

function readRoster_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get('roster');
    if (hit) { try { return JSON.parse(hit); } catch (e) { /* fall through */ } }
  }
  const r = parseRoster_();
  try { cache.put('roster', JSON.stringify(r), 120); } catch (e) { /* roster too big to cache; fine */ }
  return r;
}

function parseRoster_() {
  const out = { people: [], issues: [], headerError: '' };
  const sh = SpreadsheetApp.getActive().getSheetByName(TABS.ROSTER);
  if (!sh || sh.getLastRow() < 2) return out;
  const vals = sh.getDataRange().getValues();
  const idx = headerIndex_(vals[0]);
  if (idx.missing.length) {
    out.headerError = 'The Roster tab needs these headers in row 1: ' + ROSTER_HEADERS.join(', ') + '. Missing: ' + idx.missing.join(', ') + '.';
    return out;
  }
  const demo = normEmail_(CONFIG.DEMO_EMAIL);
  const seen = {};
  const issue = (row, who, team, text) => out.issues.push({ row: row, who: who, team: team, issue: text });
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    const first = clean_(r[idx.first], 40), last = clean_(r[idx.last], 40);
    const email = normEmail_(r[idx.email]), team = clean_(r[idx.team], 40);
    const roleRaw = clean_(r[idx.role], 40);
    if (!first && !last && !email && !team) continue;
    const name = (first + ' ' + last).trim() || email || '(blank name)';
    const line = i + 1;
    if (!CONFIG.EMAIL_PATTERN.test(email)) { issue(line, name, team, 'Email must be the 9-digit student ID + @lbschools.net. This student cannot sign in.'); continue; }
    if (email === demo) continue;
    if (seen[email]) { issue(line, name, team, 'Listed twice (also row ' + seen[email] + '). Only the first row is used.'); continue; }
    seen[email] = line;
    const role = normRole_(roleRaw);
    if (!team) issue(line, name, '', 'No Project Team. This student cannot open a board until one is added.');
    if (!roleRaw) issue(line, name, team, 'Role pending. Add a role.');
    else if (!role) issue(line, name, team, '"' + roleRaw + '" is not one of the roles: ' + CSI.ROLES.join(', ') + '.');
    out.people.push({ row: line, first: first, last: last, email: email, team: team, role: role,
      intern: yes_(r[idx.intern]), key: keyFor_(email) });
  }
  const teams = {};
  out.people.forEach(p => { if (p.team) (teams[p.team] = teams[p.team] || []).push(p); });
  Object.keys(teams).forEach(t => {
    const ps = teams[t];
    const named = arr => arr.map(p => p.first + ' ' + p.last).join(', ');
    const pms = ps.filter(p => p.role === 'PM'), apms = ps.filter(p => p.role === 'Asst PM');
    if (!pms.length) issue('', '', t, 'No PM yet.');
    if (pms.length > 1) issue('', named(pms), t, 'More than one PM. Keep one.');
    if (apms.length > 1) issue('', named(apms), t, 'More than one Asst PM. Keep one.');
    if (!ps.some(p => p.role === 'Developer' && !p.intern)) issue('', '', t, 'No Developer yet (interns do not count).');
  });
  return out;
}

function headerIndex_(row) {
  const norm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z]/g, '');
  const want = {
    first: ['first', 'firstname'], last: ['last', 'lastname'],
    email: ['email', 'districtemail', 'schoolemail', 'studentemail'],
    team: ['projectteam', 'team'], role: ['role'], intern: ['intern']
  };
  const heads = row.map(norm);
  const out = { missing: [] };
  const label = { first: 'First', last: 'Last', email: 'Email', team: 'Project Team', role: 'Role', intern: 'Intern' };
  Object.keys(want).forEach(k => {
    const i = heads.findIndex(h => want[k].indexOf(h) >= 0);
    if (i < 0) out.missing.push(label[k]); else out[k] = i;
  });
  return out;
}

function normRole_(v) {
  const k = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
  return ROLE_ALIASES[k] || '';
}
function yes_(v) { return v === true || /^(y|yes|true|x|1)$/i.test(String(v == null ? '' : v).trim()); }

// Teammates sorted by last name; each gets their own sticky-note color.
function teamMembers_(people, team) {
  return withColors_(people.filter(p => p.team === team).map(p => ({
    key: p.key, email: p.email, first: p.first, last: p.last, role: p.role, intern: p.intern
  })));
}
function withColors_(list) { return CSI.withColors(list); }
function publicMember_(m) {
  return { key: m.key, first: m.first, last: m.last, role: m.role || '', intern: !!m.intern, color: m.color };
}

// Forgiving name check: ignores case, accents, spaces, and hyphens; "Jon" matches "Jonathan";
// one of two last names is enough.
function namesMatch_(p, first, last) {
  const n = v => String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  const rf = n(p.first), rl = n(p.last), tf = n(first), tl = n(last);
  if (!tf || !tl) return false;
  const firstOk = rf === tf || (tf.length >= 2 && rf.indexOf(tf) === 0) || (rf.length >= 2 && tf.indexOf(rf) === 0);
  const lastOk = rl === tl || (tl.length >= 3 && rl.indexOf(tl) >= 0) || (rl.length >= 3 && tl.indexOf(rl) >= 0);
  return firstOk && lastOk;
}

/* ================================================================
 *  Board storage (Teams tab) and sprint history
 * ================================================================ */

function readBoard_(team) {
  const sh = sheet_(TABS.TEAMS, TEAM_HEADERS);
  const row = findRow_(sh, team);
  if (row < 0) return { board: CSI.blank(), version: 0 };
  const v = sh.getRange(row, 1, 1, TEAM_HEADERS.length).getValues()[0];
  return { board: parseChunks_(v.slice(TEAM_DATA_COL - 1)), version: Number(v[4]) || 0 };
}

function writeBoard_(team, b, version) {
  const sh = sheet_(TABS.TEAMS, TEAM_HEADERS);
  const values = [team, b.sprintNo, b.sprint, b.start ? new Date(b.start) : '', version, new Date(), b.updatedBy]
    .concat(toChunks_(b, 'This board is too full to save. Finish the sprint or delete some cards.'));
  const row = findRow_(sh, team);
  if (row > 0) sh.getRange(row, 1, 1, values.length).setValues([values]);
  else sh.appendRow(values);
  CacheService.getScriptCache().put('ver:' + team, String(version), 21600);
}

function cachedVersion_(team) {
  const v = CacheService.getScriptCache().get('ver:' + team);
  return v == null ? null : Number(v);
}

function deleteTeam_(team) {
  const sh = sheet_(TABS.TEAMS, TEAM_HEADERS);
  const row = findRow_(sh, team);
  if (row > 0) sh.deleteRow(row);
  CacheService.getScriptCache().remove('ver:' + team);
  const hs = sheet_(TABS.HISTORY, HISTORY_HEADERS);
  for (let r = hs.getLastRow(); r >= 2; r--) {
    if (String(hs.getRange(r, 2).getValue()) === team) hs.deleteRow(r);
  }
  return row > 0;
}

function allBoards_() {
  const sh = sheet_(TABS.TEAMS, TEAM_HEADERS);
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, TEAM_HEADERS.length).getValues().forEach(v => {
    if (!v[0]) return;
    out[String(v[0])] = { board: parseChunks_(v.slice(TEAM_DATA_COL - 1)), version: Number(v[4]) || 0, updated: asDate_(v[5]) };
  });
  return out;
}

function appendHistory_(team, snap) {
  const met = snap.goals.filter(g => g.result === 'met').length;
  sheet_(TABS.HISTORY, HISTORY_HEADERS).appendRow(
    [new Date(snap.finishedAt), team, snap.sprintNo, snap.sprint, met + ' of ' + snap.goals.length, snap.finishedBy || '']
      .concat(toChunks_(snap, 'This sprint is too big to save in Sprint History.')));
}

function historyRows_() {
  const sh = sheet_(TABS.HISTORY, HISTORY_HEADERS);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HISTORY_HEADERS.length).getValues().filter(v => v[1]);
}

function historyList_(team) {
  return historyRows_().filter(v => String(v[1]) === team).map(v => ({
    sprintNo: Number(v[2]), sprint: String(v[3]), finished: asDate_(v[0]) ? asDate_(v[0]).toISOString() : null,
    goalsMet: String(v[4]), by: String(v[5] || '')
  })).sort((a, b) => b.sprintNo - a.sprintNo);
}

function historySnapshot_(team, sprintNo) {
  const v = historyRows_().filter(r => String(r[1]) === team && Number(r[2]) === Number(sprintNo)).pop();
  if (!v) throw new Error('That sprint is not in Sprint History.');
  const snap = parseChunks_(v.slice(HISTORY_DATA_COL - 1));
  const raw = joinChunks_(v.slice(HISTORY_DATA_COL - 1));
  try {
    const o = JSON.parse(raw);
    snap.finishedAt = o.finishedAt || null;
    snap.finishedBy = o.finishedBy || '';
    snap.goals.forEach((g, i) => { g.result = o.goals && o.goals[i] ? o.goals[i].result : ''; });
  } catch (e) { /* keep the sanitized copy */ }
  return snap;
}

// Per team: finished sprints and, per student, how many Code cards they finished in each.
function allHistory_() {
  const out = {};
  historyRows_().forEach(v => {
    const team = String(v[1]);
    let b;
    try { b = CSI.sanitize(JSON.parse(joinChunks_(v.slice(HISTORY_DATA_COL - 1)))); } catch (e) { return; }
    (out[team] = out[team] || []).push({ sprintNo: Number(v[2]), codeDone: CSI.codeByOwner(b) });
  });
  return out;
}

// Each cell holds up to CHUNK characters. The leading "~" keeps Sheets from reading a piece as a
// number, date, or formula.
function toChunks_(obj, tooBig) {
  const s = JSON.stringify(obj);
  if (s.length > CHUNK * CHUNKS) throw new Error(tooBig);
  const out = [];
  for (let i = 0; i < CHUNKS; i++) {
    const piece = s.slice(i * CHUNK, (i + 1) * CHUNK);
    out.push(piece ? '~' + piece : '');
  }
  return out;
}
function joinChunks_(cells) {
  return cells.map(c => { const t = String(c == null ? '' : c); return t.charAt(0) === '~' ? t.slice(1) : t; }).join('');
}
function parseChunks_(cells) {
  const raw = joinChunks_(cells);
  if (!raw) return CSI.blank();
  try { return CSI.sanitize(JSON.parse(raw)); } catch (e) { return CSI.blank(); }
}

/* ================================================================
 *  Students tab: last seen and safe-sender confirmation
 * ================================================================ */

function touchStudent_(w, opts) {
  const sh = sheet_(TABS.STUDENTS, STUDENT_HEADERS);
  const row = findRow_(sh, w.email);
  const now = new Date();
  const me = w.me || {};
  if (row < 0) {
    sh.appendRow([w.email, me.first || '', me.last || '', w.team, opts.safe ? now : '', now, now]);
    return !!opts.safe;
  }
  const v = sh.getRange(row, 1, 1, STUDENT_HEADERS.length).getValues()[0];
  const safe = opts.safe ? now : v[4];
  sh.getRange(row, 1, 1, STUDENT_HEADERS.length).setValues([[w.email, me.first || v[1], me.last || v[2], w.team, safe, v[5] || now, now]]);
  return !!safe;
}

function studentsByEmail_() {
  const sh = sheet_(TABS.STUDENTS, STUDENT_HEADERS);
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, STUDENT_HEADERS.length).getValues().forEach(v => {
    const s = asDate_(v[4]), l = asDate_(v[6]);
    out[normEmail_(v[0])] = { safe: s ? s.toISOString() : null, lastSeen: l ? l.toISOString() : null };
  });
  return out;
}

// The address the board's emails come from: the account that deployed the script.
function senderEmail_() {
  try { return Session.getEffectiveUser().getEmail() || CONFIG.TEACHER_EMAIL; } catch (e) { return CONFIG.TEACHER_EMAIL; }
}

/* ================================================================
 *  Sheet + utility helpers
 * ================================================================ */

// Opaque key so the page never receives classmates' email addresses.
function keyFor_(email) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'csi-board:' + email);
  return Utilities.base64EncodeWebSafe(bytes).slice(0, 16);
}

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function resetSheet_(name, headers) {
  const sh = sheet_(name, headers);
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

// Finds a row by the value in column A (a team name or an email).
function findRow_(sh, key) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  const col = sh.getRange(2, 1, n, 1).getValues();
  const want = String(key).trim().toLowerCase();
  for (let i = 0; i < n; i++) if (String(col[i][0]).trim().toLowerCase() === want) return i + 2;
  return -1;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function asDate_(v) { return v instanceof Date && !isNaN(v) ? v : null; }
function normEmail_(e) { return String(e == null ? '' : e).trim().toLowerCase(); }
function clean_(v, n) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, n); }
function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
