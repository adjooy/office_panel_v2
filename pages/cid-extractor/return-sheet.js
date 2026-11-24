
/* =========================================================
   AD JOY PANEL
   RETURN SHEET AUTOMATION
========================================================= */

(() => {

  const RETURN_UPLOAD_URL =
    'https://script.google.com/macros/s/AKfycbxY7l21PTMOo5PAOU3wLS7vXLqg24KExHvxtDUBEhfPK-LpnrcNndClr6eCqI1lKpSshw/exec';

  const el = id => document.getElementById(id);

  const input = el('cidInput');
  const dateInput = el('returnDate');
  const extractBtn = el('extractReturnBtn');
  const uploadBtn = el('uploadReturnBtn');

  dateInput.value = getBangladeshDate();

  let uploading = false;
  let extractedSource = '';

  let returnData = {
    cids: [],
    baskets: [],
    runs: []
  };


  /* REMOVE DUPLICATES */

  function unique(values) {

    return [...new Set(values)];

  }


  /* STATUS MESSAGE */

  function setReturnMsg(text, type = '') {

    const msg = el('returnMsg');

    msg.textContent = text;

    msg.className = 'tracking-msg' +
      (type ? ' ' + type : '');

  }


  /* DISPLAY EXTRACTED DATA */

  function renderReturnData() {

    el('returnCidCount').textContent =
      returnData.cids.length;

    el('returnBasketCount').textContent =
      returnData.baskets.length;

    el('returnRunCount').textContent =
      returnData.runs.length;

    const tbody = el('returnTableBody');

    tbody.replaceChildren();

    const totalRows = Math.max(
      returnData.cids.length,
      returnData.baskets.length,
      returnData.runs.length
    );

    if (!totalRows) {

      const tr = document.createElement('tr');
      const td = document.createElement('td');

      td.colSpan = 3;
      td.textContent = 'No data extracted';

      tr.appendChild(td);
      tbody.appendChild(tr);

    }

    for (let i = 0; i < totalRows; i++) {

      const tr = document.createElement('tr');

      const values = [
        returnData.cids[i] || '',
        returnData.baskets[i] || '',
        returnData.runs[i] || ''
      ];

      values.forEach(value => {

        const td = document.createElement('td');

        td.textContent = value;

        tr.appendChild(td);

      });

      tbody.appendChild(tr);

    }

    uploadBtn.disabled =
      uploading || totalRows === 0;

  }


  /* EXTRACT RETURN DATA */

  function extractReturnData() {

    const text = input.value;

    const normalized = text
      .replace(/\\\r?\n/g, '\n')
      .replace(/\r/g, '\n');


    /* EXTRACT CID / RID */

    const cids = normalized.match(
      /\b[FRCE](?=[A-Z0-9]{10}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{10}\b/gi
    ) || [];


    /* EXTRACT BASKET IDs */

    const baskets = normalized.match(
      /\bB(?=[A-Z0-9]{10}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{10}\b/gi
    ) || [];


    /* EXTRACT RUN IDs */

    const runs = [];

    const runRegex =
      /\bRun\s*ID\s*[_:\s]*([0-9]{5,12})\b/gi;

    for (const match of normalized.matchAll(runRegex)) {

      runs.push(match[1]);

    }


    /* REMOVE ALL DUPLICATES */

    returnData = {

      cids: unique(
        cids.map(id => id.toUpperCase())
      ),

      baskets: unique(
        baskets.map(id => id.toUpperCase())
      ),

      runs: unique(runs)

    };

    extractedSource = text;

    renderReturnData();

    if (
      !returnData.cids.length &&
      !returnData.baskets.length &&
      !returnData.runs.length
    ) {

      setReturnMsg(
        'No valid Return Data found.',
        'error'
      );

      return;

    }

    setReturnMsg(

      `Extracted successfully | ` +
      `CID/RID: ${returnData.cids.length} | ` +
      `Basket: ${returnData.baskets.length} | ` +
      `Run: ${returnData.runs.length}`,

      'success'

    );

  }


  /* CLEAR RETURN DATA */

  function clearReturnData() {

    extractedSource = '';

    returnData = {
      cids: [],
      baskets: [],
      runs: []
    };

    renderReturnData();

    setReturnMsg('');

  }


  /* UPLOAD RETURN DATA */

  async function uploadReturnData() {

    if (uploading) return;

    if (
      !RETURN_UPLOAD_URL ||
      RETURN_UPLOAD_URL.includes('PASTE_YOUR')
    ) {

      setReturnMsg(
        'Return Sheet Web App URL is not configured.',
        'error'
      );

      return;

    }

    if (input.value !== extractedSource) {

      clearReturnData();

      setReturnMsg(
        'Input changed. Extract Return Data again.',
        'error'
      );

      return;

    }

    const date = dateInput.value;

    if (!date) {

      setReturnMsg('Select a date first.', 'error');

      return;

    }

    if (
      !returnData.cids.length &&
      !returnData.baskets.length &&
      !returnData.runs.length
    ) {

      setReturnMsg('No data to upload.', 'error');

      return;

    }

    const confirmed = confirm(

      `Date: ${date}\n\n` +

      `Consignment: ${returnData.cids.length}\n` +

      `Basket: ${returnData.baskets.length}\n` +

      `Run: ${returnData.runs.length}\n\n` +

      'Upload to Return & Area Change Sheet?'

    );

    if (!confirmed) return;

    uploading = true;

    uploadBtn.disabled = true;
    extractBtn.disabled = true;
    dateInput.disabled = true;
    input.readOnly = true;
    el('clearCidBtn').disabled = true;

    uploadBtn.textContent = 'Uploading...';

    setReturnMsg(
      'Uploading to Return Sheet...',
      'info'
    );

    try {

      const response = await fetch(
        RETURN_UPLOAD_URL,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },

          body: JSON.stringify({

            action: 'uploadReturnData',

            date: date,

            cids: returnData.cids,

            baskets: returnData.baskets,

            runs: returnData.runs

          })

        }
      );

      if (!response.ok) {

        throw new Error(
          'HTTP Error: ' + response.status
        );

      }

      const result = await response.json();

      if (!result.ok) {

        throw new Error(
          result.error || 'Unknown upload error'
        );

      }

      setReturnMsg(

        `✓ ${result.tabName} | ${result.date} | ` +

        `CID Added: ${result.cidAdded} | ` +

        `Basket Added: ${result.basketAdded} | ` +

        `Run Added: ${result.runAdded} | ` +

        `Duplicate Skipped: ${result.skipped} | ` +

        `Time: ${result.executionTime}s`,

        'success'

      );

    } catch (err) {

      setReturnMsg(
        'Upload Failed: ' + err.message,
        'error'
      );

    } finally {

      uploading = false;

      extractBtn.disabled = false;
      dateInput.disabled = false;
      input.readOnly = false;
      el('clearCidBtn').disabled = false;

      uploadBtn.textContent =
        'Upload to Return Sheet';

      renderReturnData();

    }

  }


  /* BUTTON EVENTS */

  extractBtn.addEventListener(
    'click',
    extractReturnData
  );

  uploadBtn.addEventListener(
    'click',
    uploadReturnData
  );

  el('clearCidBtn').addEventListener(
    'click',
    clearReturnData
  );

  input.addEventListener('input', () => {

    if (!uploading) clearReturnData();

  });

  renderReturnData();

})();
