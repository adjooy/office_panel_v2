
/* =========================================================
   AD JOY PANEL
   CID EXTRACTOR & TRACKING SHEET AUTOMATION
========================================================= */

const TRACKING_UPLOAD_URL =
  'https://script.google.com/macros/s/AKfycbwI3t_4skwtWpGNm6WnMKQuB4fzCRjuSV9M_GBuzfPlMr88QWTz3Hz10zGGE6V8fMYW/exec';


/* BANGLADESH CURRENT DATE */

function getBangladeshDate() {

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const date = {};

  parts.forEach(p => {
    date[p.type] = p.value;
  });

  return `${date.year}-${date.month}-${date.day}`;

}

document.getElementById('trackingDate').value =
  getBangladeshDate();


/* DATE TO TRACKING SHEET TAB NAME */

function trackingTabName(dateStr) {

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr',
    'May', 'Jun', 'Jul', 'Aug',
    'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const parts = dateStr.split('-');

  return `${months[Number(parts[1]) - 1]} ${Number(parts[2])}`;

}


/* CID EXTRACTOR */

function extractCIDs() {

  const input = document.getElementById('cidInput').value;

  const matches = input.match(
    /\b[FRCE](?=[A-Z0-9]{10}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{10}\b/gi
  ) || [];

  const uniqueCIDs = [
    ...new Set(matches.map(cid => cid.toUpperCase()))
  ];

  document.getElementById('cidOutput').value =
    uniqueCIDs.join('\n');

  document.getElementById('cidCount').textContent =
    `${uniqueCIDs.length}টি unique CID পাওয়া গেছে`;

  setTrackingMsg('');

  return uniqueCIDs;

}


/* EXTRACT BUTTON */

document.getElementById('extractCidBtn')
  .addEventListener('click', extractCIDs);


/* CLEAR BUTTON */

document.getElementById('clearCidBtn')
  .addEventListener('click', () => {

    document.getElementById('cidInput').value = '';

    document.getElementById('cidOutput').value = '';

    document.getElementById('cidCount').textContent =
      '0 unique CID পাওয়া গেছে';

    setTrackingMsg('');

  });


/* COPY CID BUTTON */

document.getElementById('copyCidBtn')
  .addEventListener('click', function() {

    const text = document.getElementById('cidOutput').value;

    if (!text) {

      alert('First extract the CID list.');

      return;

    }

    copyText(text, this);

  });


/* TRACKING STATUS MESSAGE */

function setTrackingMsg(text, type = '') {

  const el = document.getElementById('trackingMsg');

  el.textContent = text;

  el.className = 'tracking-msg' +
    (type ? ' ' + type : '');

}


/* TRACKING SHEET UPLOAD */

let trackingUploading = false;

async function uploadToTracking(type) {

  if (trackingUploading) return;

  if (
    !TRACKING_UPLOAD_URL ||
    TRACKING_UPLOAD_URL.includes('PASTE_YOUR')
  ) {

    setTrackingMsg(
      'Tracking Sheet Web App URL is not configured.',
      'error'
    );

    return;

  }

  const cids = extractCIDs();

  if (!cids.length) {

    setTrackingMsg(
      'কোনো valid CID পাওয়া যায়নি।',
      'error'
    );

    return;

  }

  const dateStr =
    document.getElementById('trackingDate').value;

  if (!dateStr) {

    setTrackingMsg('আগে Date Select করুন।', 'error');

    return;

  }

  const tabName = trackingTabName(dateStr);

  const columnName =
    type === 'yesterday'
      ? 'Yesterday Hold'
      : 'Morning Received';

  const confirmed = confirm(

    `Date: ${dateStr}\n` +
    `Sheet: ${tabName}\n` +
    `Column: ${columnName}\n` +
    `Total CID: ${cids.length}\n\n` +
    'Upload to Tracking Sheet?'

  );

  if (!confirmed) return;

  const yesterdayBtn =
    document.getElementById('addYesterdayBtn');

  const morningBtn =
    document.getElementById('addMorningBtn');

  const activeBtn =
    type === 'yesterday'
      ? yesterdayBtn
      : morningBtn;

  const oldText = activeBtn.textContent;

  trackingUploading = true;

  yesterdayBtn.disabled = true;
  morningBtn.disabled = true;

  activeBtn.textContent = 'Uploading...';

  setTrackingMsg(
    `${tabName} → ${columnName} এ CID Upload হচ্ছে...`,
    'info'
  );

  try {

    const response = await fetch(
      TRACKING_UPLOAD_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify({
          action: 'uploadTrackingCIDs',
          date: dateStr,
          type: type,
          cids: cids
        })
      }
    );

    if (!response.ok) {

      throw new Error('HTTP Error: ' + response.status);

    }

    const data = await response.json();

    if (!data.ok) {

      throw new Error(data.error || 'Unknown upload error');

    }

    setTrackingMsg(

      `✓ ${data.tabName} → ${data.columnName}` +
      ` | Added: ${data.added}` +
      ` | Duplicate Skipped: ${data.skipped}` +
      ` | Total: ${data.total}` +
      ` | Time: ${data.executionTime}s`,

      'success'

    );

  } catch (err) {

    setTrackingMsg(
      'Upload Failed: ' + err.message,
      'error'
    );

  } finally {

    trackingUploading = false;

    yesterdayBtn.disabled = false;
    morningBtn.disabled = false;

    activeBtn.textContent = oldText;

  }

}


/* YESTERDAY HOLD BUTTON */

document.getElementById('addYesterdayBtn')
  .addEventListener('click', () => {

    uploadToTracking('yesterday');

  });


/* MORNING RECEIVED BUTTON */

document.getElementById('addMorningBtn')
  .addEventListener('click', () => {

    uploadToTracking('morning');

  });
