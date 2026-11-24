/* Depends on common.js:
   pad, formatDateLong, formatDateShort, copyRichHTML
*/

let returnMailHTML = '';
let returnMailText = '';
let returnSubject = '';
let returnMailReady = false;

const RETURN_TO =
  'return@carrybee.com,centralsort@carrybee.com';

const RETURN_CC =
  'Moulvibazar-Barlekha@carrybee.com,' +
  'ruhin.shimul@carrybee.com,' +
  'dipto.d@carrybee.com,' +
  'transport@carrybee.com,' +
  'bhairab.sub-sort@carrybee.com';

const returnInput = document.getElementById('returnInput');
const returnDate = document.getElementById('returnDate');
const returnPreview = document.getElementById('returnPreview');
const copyReturnBtn = document.getElementById('copyReturnBtn');
const openReturnBtn = document.getElementById('openReturnBtn');

function escapeReturnHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function parseReturnData(text) {
  const consignmentRegex = /^[FRCE](?=[A-Z0-9]{10}$)(?=[A-Z0-9]*\d)[A-Z0-9]{10}$/;
  const basketRegex = /^B(?=[A-Z0-9]{10}$)(?=[A-Z0-9]*\d)[A-Z0-9]{10}$/;
  const runRegex = /^\d{5,12}$/;

  const rows = [];
  const seen = new Map();
  const basketIds = new Set();
  let current = null;

  function saveCurrent() {
    if (!current) return;
    const prior = seen.get(current.consignment);
    if (prior) {
      // Repeat of the same ID with different metadata should not create
      // another parcel or a misleading email count.
      if ((prior.basket && current.basket && prior.basket !== current.basket) ||
          (prior.run && current.run && prior.run !== current.run)) {
        throw new Error('Conflicting Basket/Run for ' + current.consignment);
      }
      if (!prior.basket) prior.basket = current.basket || '';
      if (!prior.run) prior.run = current.run || '';
    } else {
      const row = { ...current };
      seen.set(row.consignment, row);
      rows.push(row);
    }
    if (current.basket) basketIds.add(current.basket);
    current = null;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().toUpperCase();
    if (!line) continue;
    // CID Extractor provides tab-separated rows. Only accept pure
    // ID fields, not arbitrary numeric values from a copied web page.
    const tokens = line.split(/\s+/).filter(Boolean);
    const first = tokens[0];
    if (consignmentRegex.test(first)) {
      saveCurrent();
      current = { consignment: first, basket: '', run: '' };
      for (const token of tokens.slice(1)) {
        if (basketRegex.test(token)) current.basket = token;
        else if (runRegex.test(token)) current.run = token;
      }
    } else if (current && tokens.length === 1) {
      if (basketRegex.test(first)) current.basket = first;
      else if (runRegex.test(first)) current.run = first;
    }
  }
  saveCurrent();
  return {
    rows,
    consignmentCount: rows.length,
    basketCount: basketIds.size
  };
}

function resetReturnMail() {
  returnMailHTML = '';
  returnMailText = '';
  returnSubject = '';
  returnMailReady = false;

  returnPreview.innerHTML =
    '<span style="color:#98a2b3">Preview will appear here</span>';

  copyReturnBtn.style.display = 'none';
  openReturnBtn.style.display = 'none';
}

function generateReturnMail() {
  resetReturnMail();

  const input = returnInput.value.trim();
  const date = returnDate.value;

  if (!input) {
    alert('Paste return data first.');
    return;
  }

  if (!date) {
    alert('Select the mail date.');
    return;
  }

  let parsed;
  try {
    parsed = parseReturnData(input);
  } catch (err) {
    alert('Return data conflict: ' + err.message);
    return;
  }
  const { rows, consignmentCount, basketCount } = parsed;

  if (!consignmentCount) {
    alert(
      'No valid consignment ID found. Check the extracted CID/RID list.'
    );
    return;
  }

  if (!basketCount) {
    alert('No valid basket ID found. Basket IDs must start with B.');
    return;
  }

  const shortDate = formatDateShort(date);
  const longDate = formatDateLong(date);

  const parcelLabel = consignmentCount === 1 ? 'parcel' : 'parcels';
  const basketLabel = basketCount === 1 ? 'basket' : 'baskets';

  const transferMessage =
    `We are transferring ${consignmentCount} return ${parcelLabel} ` +
    `in ${basketCount} ${basketLabel} from the Moulvibazar-Barlekha Hub ` +
    `via Linehaul-13.1.`;

  returnSubject =
    `Return Parcels Sending to Central Sort from ` +
    `Moulvibazar-Barlekha Hub ${longDate}`;

  const tableRows = rows.map((row, index) => `
    <tr style="background:${index % 2 ? '#f8f8f8' : '#ffffff'}">
      <td style="border:1px solid #d0d0d0;padding:5px 7px;">
        ${escapeReturnHTML(row.consignment)}
      </td>
      <td style="border:1px solid #d0d0d0;padding:5px 7px;">
        ${escapeReturnHTML(row.basket || '')}
      </td>
      <td style="border:1px solid #d0d0d0;padding:5px 7px;">
        ${escapeReturnHTML(row.run || '')}
      </td>
    </tr>
  `).join('');

  returnMailHTML = `
    <div style="
      font-family:Arial,sans-serif;
      font-size:13px;
      color:#111;
      line-height:1.55;
    ">
      <p>Dear Team,</p>

      <p>${escapeReturnHTML(transferMessage)}</p>

      <p>
        Detailed parcel information is provided below for your reference.
      </p>

      <p>
        <strong>Total Consignments:</strong> ${consignmentCount}<br>
        <strong>Total Baskets:</strong> ${basketCount}
      </p>

      <table style="
        border-collapse:collapse;
        width:365px;
        max-width:100%;
        font-family:Arial,sans-serif;
        font-size:13px;
      ">
        <thead>
          <tr>
            <th colspan="3" style="
              border:1px solid #d0d0d0;
              padding:7px;
              background:#eeeeee;
              text-align:center;
              font-weight:bold;
              font-size:14px;
            ">
              ${escapeReturnHTML(shortDate)}
            </th>
          </tr>

          <tr>
            ${['Consignment ID', 'Basket ID', 'RUN ID'].map(label => `
              <th style="
                border:1px solid #d0d0d0;
                padding:6px;
                background:#2563eb;
                color:white;
                text-align:center;
              ">
                ${label}
              </th>
            `).join('')}
          </tr>
        </thead>

        <tbody>${tableRows}</tbody>
      </table>

      <p><br></p>
    </div>
  `;

  const textRows = rows.map(row =>
    `${row.consignment}\t${row.basket || ''}\t${row.run || ''}`
  ).join('\n');

  returnMailText = `Dear Team,

${transferMessage}

Detailed parcel information is provided below for your reference.

Total Consignments: ${consignmentCount}
Total Baskets: ${basketCount}

${shortDate}

Consignment ID\tBasket ID\tRUN ID
${textRows}

`;

  returnPreview.innerHTML = `
    <div class="subject-preview">
      <b>Subject:</b> ${escapeReturnHTML(returnSubject)}<br>
      <b>To:</b> ${escapeReturnHTML(RETURN_TO)}<br>
      <b>CC:</b> ${escapeReturnHTML(RETURN_CC)}
    </div>

    ${returnMailHTML}
  `;

  returnMailReady = true;

  copyReturnBtn.style.display = 'inline-block';
  openReturnBtn.style.display = 'inline-block';
}

async function copyReturnMail() {
  if (!returnMailReady || copyReturnBtn.disabled) {
    return;
  }

  copyReturnBtn.disabled = true;

  try {
    const copied = await copyRichHTML(
      returnMailHTML,
      returnMailText,
      copyReturnBtn
    );

    if (copied === false) {
      throw new Error('Clipboard copy failed.');
    }
  } catch (error) {
    console.error('Could not copy return mail:', error);

    alert(
      'Could not copy the mail. Please allow clipboard access and try again.'
    );
  } finally {
    copyReturnBtn.disabled = false;
    copyReturnBtn.textContent = 'Copy Mail';
  }
}

function openReturnGmail() {
  if (!returnMailReady) {
    return;
  }

  const url =
    'https://mail.google.com/mail/u/0/?view=cm&fs=1' +
    '&to=' + encodeURIComponent(RETURN_TO) +
    '&cc=' + encodeURIComponent(RETURN_CC) +
    '&su=' + encodeURIComponent(returnSubject);

  const gmailWindow = window.open('about:blank', '_blank');

  if (gmailWindow) {
    gmailWindow.opener = null;
    gmailWindow.location.href = url;
  } else {
    window.location.href = url;
  }
}

const now = new Date();

returnDate.value =
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

document.getElementById('generateReturnBtn')
  .addEventListener('click', generateReturnMail);

document.getElementById('clearReturnBtn')
  .addEventListener('click', () => {
    returnInput.value = '';
    resetReturnMail();
  });

copyReturnBtn.addEventListener('click', copyReturnMail);
openReturnBtn.addEventListener('click', openReturnGmail);

// Hide outdated mail when input or date changes.
returnInput.addEventListener('input', resetReturnMail);
returnDate.addEventListener('input', resetReturnMail);

// Initial state.
copyReturnBtn.textContent = 'Copy Mail';
openReturnBtn.textContent = 'Open Mail';
resetReturnMail();

/* AUTO-IMPORT FROM CID EXTRACTOR; NEVER SEND EMAIL AUTOMATICALLY */
function importReturnMailHandoff() {
  const key = 'adjoy:return-mail-transfer:v1';
  let raw = null;
  try {
    raw = sessionStorage.getItem(key);
    if (!raw) return;
    // Consume once so refreshing does not overwrite manual edits.
    sessionStorage.removeItem(key);

    const payload = JSON.parse(raw);
    if (payload.version !== 1 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
        typeof payload.text !== 'string' ||
        payload.text.length > 200000 ||
        !payload.text.trim()) {
      throw new Error('Invalid transfer payload');
    }

    returnDate.value = payload.date;
    returnInput.value = payload.text;

    const hint = document.getElementById('returnDataHint');
    if (hint) {
      hint.textContent =
        'Imported from CID Extractor. Review the IDs and mail preview before sending.';
    }

    generateReturnMail();
  } catch (err) {
    console.warn('Return Mail transfer could not be loaded:', err);
  }
}

importReturnMailHandoff();
